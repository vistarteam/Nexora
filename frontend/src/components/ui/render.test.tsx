import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { AnalysisStatusBadge, Badge } from './Badge';
import { Button } from './Button';
import { Card, CardBody, CardHeader } from './Card';
import { SegmentedControl } from './Field';
import { EmptyState, ErrorState, Spinner } from './Feedback';
import { PageHeader } from './PageHeader';
import { StatCard } from './StatCard';

/**
 * Server-render smoke tests.
 *
 * These render the real components to HTML in Node (no jsdom needed) and assert
 * the semantics that matter: accessible roles, labels, and the fact that no
 * component renders `undefined`/empty output. They are not a substitute for
 * visual review, but they catch broken markup and missing ARIA wiring.
 */

const render = (element: JSX.Element): string => renderToStaticMarkup(element);

describe('Button', () => {
  it('renders its label and is not disabled by default', () => {
    const html = render(<Button>اجرا</Button>);
    expect(html).toContain('اجرا');
    expect(html).not.toContain('disabled');
  });

  it('is disabled and busy while loading, and hides the label', () => {
    const html = render(
      <Button loading loadingLabel="در حال اجرا…">
        اجرا
      </Button>,
    );
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy');
    expect(html).toContain('در حال اجرا…');
  });
});

describe('Badge family', () => {
  it('labels each analysis status in Persian', () => {
    expect(render(<AnalysisStatusBadge status="ok" />)).toContain('تحلیل کامل');
    expect(render(<AnalysisStatusBadge status="insufficient_data" />)).toContain('داده ناکافی');
    expect(render(<AnalysisStatusBadge status="unavailable" />)).toContain('در دسترس نیست');
  });

  it('renders arbitrary content with a tone', () => {
    const html = render(<Badge tone="bull">صعودی</Badge>);
    expect(html).toContain('صعودی');
    expect(html).toContain('text-bull');
  });
});

describe('Card', () => {
  it('renders a heading, description and body', () => {
    const html = render(
      <Card>
        <CardHeader title="اندیکاتورها" description="محاسبه‌شده از کندل‌ها" />
        <CardBody>محتوا</CardBody>
      </Card>,
    );
    expect(html).toContain('<h2');
    expect(html).toContain('اندیکاتورها');
    expect(html).toContain('محاسبه‌شده از کندل‌ها');
    expect(html).toContain('محتوا');
  });
});

describe('StatCard', () => {
  it('shows value and hint', () => {
    const html = render(<StatCard label="نمادها" value="۱۴" hint="واچ‌لیست" />);
    expect(html).toContain('نمادها');
    expect(html).toContain('۱۴');
    expect(html).toContain('واچ‌لیست');
  });

  it('renders a placeholder instead of a value while loading', () => {
    const html = render(<StatCard label="نمادها" value="۱۴" loading />);
    expect(html).not.toContain('>۱۴<');
  });
});

describe('SegmentedControl', () => {
  it('exposes radiogroup semantics and marks the selected option', () => {
    const html = render(
      <SegmentedControl
        ariaLabel="کلاس دارایی"
        value="crypto"
        onChange={() => undefined}
        options={[
          { value: 'crypto', label: 'ارز دیجیتال' },
          { value: 'forex', label: 'فارکس' },
        ]}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="کلاس دارایی"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
  });
});

describe('Feedback states', () => {
  it('announces spinners to assistive technology', () => {
    const html = render(<Spinner label="در حال بارگذاری" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('در حال بارگذاری');
  });

  it('renders an empty state with an action', () => {
    const html = render(
      <EmptyState title="واچ‌لیست خالی است" description="نمادی اضافه کنید" action={<a href="/x">افزودن</a>} />,
    );
    expect(html).toContain('واچ‌لیست خالی است');
    expect(html).toContain('افزودن');
  });

  it('surfaces the API message, field issues and error code', () => {
    const error = new ApiError('پارامترهای ورودی نامعتبر است.', {
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [{ path: 'query.symbol', message: 'نماد الزامی است.' }],
    });

    const html = render(<ErrorState error={error} onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('پارامترهای ورودی نامعتبر است.');
    expect(html).toContain('query.symbol');
    expect(html).toContain('VALIDATION_ERROR');
    expect(html).toContain('تلاش مجدد');
  });

  it('omits the retry button when no handler is provided', () => {
    const html = render(<ErrorState error={new Error('boom')} />);
    expect(html).toContain('boom');
    expect(html).not.toContain('تلاش مجدد');
  });
});

describe('PageHeader', () => {
  it('renders title, description, badges and actions', () => {
    const html = render(
      <PageHeader
        title="تحلیل هوشمند"
        description="توضیح"
        badges={<Badge tone="accent">فعال</Badge>}
        actions={<Button>اجرا</Button>}
      />,
    );
    expect(html).toContain('<h1');
    expect(html).toContain('تحلیل هوشمند');
    expect(html).toContain('فعال');
    expect(html).toContain('اجرا');
  });
});

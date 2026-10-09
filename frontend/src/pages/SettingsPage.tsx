import { useState } from 'react';
import { SymbolPicker } from '../components/market/SymbolPicker';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { SegmentedControl, Toggle } from '../components/ui/Field';
import { LockIcon } from '../components/ui/Icons';
import { PageHeader } from '../components/ui/PageHeader';
import { useSettings, type Theme } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { useToast } from '../context/ToastContext';
import { createStorage, OWNED_KEYS } from '../lib/storage';
import { ASSET_CLASS_LABELS, ENGINE_LABELS, TIMEFRAME_LABELS } from '../lib/format';
import { ASSET_CLASSES, TIMEFRAMES, type AssetClass, type Timeframe } from '../types/nexora';

/**
 * Settings.
 *
 * Every control on this page takes effect immediately and is persisted. The
 * account/subscription area is explicitly marked as a placeholder: it is
 * disabled, labelled «به‌زودی», and says what it will do — it never pretends to
 * work.
 */
export function SettingsPage(): JSX.Element {
  const { settings, update, reset, storagePersistent, storageDriver } = useSettings();
  const { health, bootstrap } = useSystem();
  const { success, info } = useToast();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const clearLocalData = (): void => {
    createStorage().clearOwned();
    setConfirmingReset(false);
    reset();
    info('داده‌های محلی پاک شد. برای اعمال کامل، صفحه را دوباره بارگذاری کنید.');
    success('تنظیمات به مقادیر پیش‌فرض بازگشت.');
  };

  return (
    <div>
      <PageHeader
        title="تنظیمات"
        description="ظاهر، قالب اعداد، مقادیر پیش‌فرض و رفتار برنامه. همه تنظیمات بی‌درنگ اعمال و ذخیره می‌شوند."
        badges={
          <>
            <Badge tone={storagePersistent ? 'accent' : 'warn'} dot>
              {storagePersistent ? `ذخیره‌سازی محلی: ${storageDriver}` : 'ذخیره‌سازی محلی غیرفعال'}
            </Badge>
          </>
        }
      />

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="ظاهر" description="پوسته و قالب نمایش اعداد در کل برنامه." />
          <CardBody className="space-y-5">
            <div>
              <span className="nx-label">پوسته</span>
              <SegmentedControl<Theme>
                ariaLabel="انتخاب پوسته"
                value={settings.theme}
                onChange={(value) => update('theme', value)}
                options={[
                  { value: 'dark', label: 'تیره (پیش‌فرض)' },
                  { value: 'light', label: 'روشن' },
                ]}
              />
              <p className="mt-2 text-2xs leading-6 text-ink-subtle">
                پوسته روی همه اجزا اعمال می‌شود؛ نمودار TradingView نیز با پوسته هم‌راه می‌شود.
              </p>
            </div>

            <div>
              <span className="nx-label">قالب اعداد</span>
              <SegmentedControl<'fa' | 'en'>
                ariaLabel="قالب اعداد"
                value={settings.numerals}
                onChange={(value) => update('numerals', value)}
                options={[
                  { value: 'fa', label: 'فارسی (۱۲۳)' },
                  { value: 'en', label: 'لاتین (123)' },
                ]}
              />
              <p className="mt-2 text-2xs leading-6 text-ink-subtle">
                قالب اعداد بر قیمت‌ها، درصدها و تاریخ‌ها اعمال می‌شود.
              </p>
            </div>

            <Toggle
              checked={settings.compactTables}
              onChange={(value) => update('compactTables', value)}
              label="جدول‌های جمع‌وجور"
              description="ارتفاع ردیف‌ها کمتر می‌شود؛ در صفحه‌های کوچک مفید است."
            />

            <Toggle
              checked={settings.showCaveats}
              onChange={(value) => update('showCaveats', value)}
              label="نمایش محدودیت‌های تحلیل"
              description="بخش هشدارها و محدودیت‌های گزارش تحلیل نمایش داده شود."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="مقادیر پیش‌فرض تحلیل"
            description="صفحه‌های تحلیل و نمودار با این مقادیر باز می‌شوند."
          />
          <CardBody className="space-y-5">
            <div>
              <span className="nx-label">نماد پیش‌فرض</span>
              <SymbolPicker
                value={settings.defaultSymbol ?? bootstrap?.defaults.symbol ?? null}
                assetClass={settings.defaultAssetClass}
                onSelect={(market) => {
                  update('defaultSymbol', market.symbol);
                  update('defaultAssetClass', market.assetClass);
                }}
                label="انتخاب نماد پیش‌فرض"
              />
              <p className="mt-2 text-2xs text-ink-subtle">
                {settings.defaultSymbol
                  ? `نماد پیش‌فرض فعلی: ${settings.defaultSymbol}`
                  : `در حال استفاده از پیش‌فرض سرور: ${bootstrap?.defaults.symbol ?? '—'}`}
              </p>
            </div>

            <div>
              <span className="nx-label">کلاس دارایی پیش‌فرض</span>
              <SegmentedControl<AssetClass>
                ariaLabel="کلاس دارایی پیش‌فرض"
                value={settings.defaultAssetClass}
                onChange={(value) => {
                  update('defaultAssetClass', value);
                  update('defaultSymbol', null);
                }}
                options={ASSET_CLASSES.map((item) => ({
                  value: item,
                  label: ASSET_CLASS_LABELS[item],
                }))}
              />
            </div>

            <div>
              <span className="nx-label">تایم‌فریم پیش‌فرض</span>
              <SegmentedControl<Timeframe>
                ariaLabel="تایم‌فریم پیش‌فرض"
                value={settings.defaultTimeframe}
                onChange={(value) => update('defaultTimeframe', value)}
                options={TIMEFRAMES.map((item) => ({
                  value: item,
                  label: TIMEFRAME_LABELS[item],
                }))}
              />
            </div>

            <Toggle
              checked={settings.autoRunAnalysis}
              onChange={(value) => update('autoRunAnalysis', value)}
              label="اجرای خودکار تحلیل"
              description="در صفحه «تحلیل هوشمند»، با تغییر نماد یا تایم‌فریم تحلیل به‌صورت خودکار اجرا شود."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="داده‌های محلی و وضعیت سیستم"
            description="تنظیمات و واچ‌لیست به‌صورت محلی نیز نگهداری می‌شوند."
          />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-2xs">
              <div>
                <dt className="text-ink-subtle">درایور محلی</dt>
                <dd className="ltr-data mt-1 text-ink">{storageDriver}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">کلیدهای ذخیره‌شده</dt>
                <dd className="num mt-1 text-ink">{OWNED_KEYS.length}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">منبع داده</dt>
                <dd className="mt-1 text-ink">
                  {bootstrap ? bootstrap.marketData.label : '—'}
                  {bootstrap?.marketData.isDemo ? ' (دمو)' : ''}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">موتور تحلیل</dt>
                <dd className="mt-1 text-ink">
                  {health
                    ? health.checks.analysisEngine.status === 'available'
                      ? ENGINE_LABELS.python
                      : ENGINE_LABELS['typescript-fallback']
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">ذخیره‌سازی سرور</dt>
                <dd className="mt-1 text-ink">
                  {health
                    ? `${health.checks.storage.driver}${health.checks.storage.persistent ? ' (پایدار)' : ' (غیرپایدار)'}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">نسخه API</dt>
                <dd className="ltr-data mt-1 text-ink">{health?.version ?? '—'}</dd>
              </div>
            </dl>

            {!confirmingReset ? (
              <Button variant="secondary" onClick={() => setConfirmingReset(true)}>
                بازنشانی تنظیمات
              </Button>
            ) : (
              <div className="rounded-lg border border-bear/35 bg-bear/[0.07] p-3">
                <p className="text-2xs leading-6 text-ink-muted">
                  با این کار تنظیمات، حافظه محلی واچ‌لیست و آخرین انتخاب‌ها پاک می‌شود. داده‌های
                  ذخیره‌شده در سرور حذف نمی‌شوند.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="danger" size="sm" onClick={clearLocalData}>
                    بله، پاک کن
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingReset(false)}>
                    انصراف
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="حساب کاربری و اشتراک"
            description="این بخش هنوز پیاده‌سازی نشده است."
            actions={<Badge tone="neutral">به‌زودی</Badge>}
          />
          <CardBody>
            <div
              className="rounded-lg border border-dashed border-border-strong bg-base-900/40 p-4"
              aria-disabled="true"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-base-800 text-ink-subtle">
                  <LockIcon width={16} height={16} />
                </span>
                <div>
                  <p className="text-xs font-medium text-ink">حساب کاربری، اشتراک و اعلان‌ها</p>
                  <p className="mt-1.5 text-2xs leading-6 text-ink-muted">
                    ورود کاربران، پلن‌های اشتراک، تحلیل زمان‌بندی‌شده و اعلان قیمت در نسخه‌های بعدی
                    افزوده می‌شود. هیچ‌کدام از این قابلیت‌ها در حال حاضر فعال نیست و به‌همین دلیل تمام
                    کنترل‌های این بخش غیرفعال هستند.
                  </p>
                  <ul className="mt-3 space-y-1.5 text-2xs text-ink-subtle">
                    <li>• احراز هویت و مدیریت حساب</li>
                    <li>• اشتراک و سطوح دسترسی</li>
                    <li>• هشدارهای قیمتی و گزارش‌های زمان‌بندی‌شده</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

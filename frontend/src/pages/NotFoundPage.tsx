import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/Feedback';
import { PageHeader } from '../components/ui/PageHeader';

export function NotFoundPage(): JSX.Element {
  return (
    <div>
      <PageHeader title="صفحه یافت نشد" description="نشانی وارد‌شده با هیچ صفحه‌ای در نکسورا مطابقت ندارد." />
      <div className="nx-card">
        <EmptyState
          title="خطای ۴۰۴"
          description="ممکن است نشانی تغییر کرده یا اشتباه وارد شده باشد. از منوی کنار می‌توانید به بخش‌های اصلی برنامه بروید."
          action={
            <Link to="/" className="nx-btn-primary text-xs">
              بازگشت به داشبورد
            </Link>
          }
        />
      </div>
    </div>
  );
}

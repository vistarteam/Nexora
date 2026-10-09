import type { ComponentType, SVGProps } from 'react';
import {
  ChartIcon,
  ClockIcon,
  DashboardIcon,
  SettingsIcon,
  SparkIcon,
  StarIcon,
} from '../ui/Icons';

export interface NavItem {
  to: string;
  label: string;
  /** Short description used by the mobile drawer and the page title tooltip. */
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** `end` for the index route so it is not always marked active. */
  end?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/',
    label: 'داشبورد',
    description: 'نمای کلی بازار، واچ‌لیست و آخرین تحلیل‌ها',
    icon: DashboardIcon,
    end: true,
  },
  {
    to: '/market',
    label: 'تحلیل بازار',
    description: 'نمودار TradingView و انتخاب نماد و تایم‌فریم',
    icon: ChartIcon,
  },
  {
    to: '/ai-analysis',
    label: 'تحلیل هوشمند',
    description: 'اندیکاتورها، سطوح کلیدی و سناریوهای شرطی',
    icon: SparkIcon,
  },
  {
    to: '/watchlist',
    label: 'واچ‌لیست',
    description: 'نمادهای منتخب شما',
    icon: StarIcon,
  },
  {
    to: '/history',
    label: 'تاریخچه تحلیل',
    description: 'گزارش‌های ذخیره‌شده',
    icon: ClockIcon,
  },
  {
    to: '/settings',
    label: 'تنظیمات',
    description: 'ظاهر، اعداد و تنظیمات پیش‌فرض',
    icon: SettingsIcon,
  },
];

import {
  LineChart,
  Radio,
  SearchCheck,
  Timer,
  Upload,
  BarChart3,
  BookOpen,
  Boxes,
  ClipboardList,
  FileText,
  Image,
  LayoutDashboard,
  Layers,
  type LucideIcon,
  Megaphone,
  Package,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Users,
} from 'lucide-react';

import type { AdminIconName } from '@/config/admin-nav';

/**
 * Resolves the icon names carried by `admin-nav.ts`.
 *
 * The indirection exists because the nav config is read on the server, where a
 * component reference cannot travel. Keeping the map here means the lucide
 * import lands in exactly one client bundle.
 */
export const ADMIN_ICONS: Record<AdminIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  reports: BarChart3,
  products: Package,
  categories: Tags,
  collections: Layers,
  inventory: Boxes,
  media: Image,
  orders: ShoppingCart,
  customers: Users,
  promotions: Megaphone,
  pages: FileText,
  blog: BookOpen,
  seo: Search,
  staff: ShieldCheck,
  audit: ClipboardList,
  settings: Settings,
  imports: Upload,
  jobs: Timer,
  analytics: LineChart,
  search: SearchCheck,
  marketing: Radio,
};

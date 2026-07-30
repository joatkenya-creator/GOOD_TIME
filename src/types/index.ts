/**
 * Shared type surface.
 *
 * Prisma's generated types are the source of truth for anything persisted —
 * re-exported here rather than hand-mirrored, so a schema change is a compile
 * error instead of a runtime surprise.
 */
export type {
  AddressModel as Address,
  BrandModel as Brand,
  CartItemModel as CartItem,
  CartModel as Cart,
  CategoryModel as Category,
  CollectionModel as Collection,
  CouponModel as Coupon,
  InventoryModel as Inventory,
  MediaModel as Media,
  OrderItemModel as OrderItem,
  OrderModel as Order,
  PageModel as Page,
  PaymentModel as Payment,
  PostModel as Post,
  ProductModel as Product,
  ReviewModel as Review,
  RoleModel as Role,
  SeoMetadataModel as SeoMetadata,
  ShipmentModel as Shipment,
  UserModel as User,
  VariantModel as Variant,
  WishlistModel as Wishlist,
} from '@/generated/prisma/models';

export type {
  AddressType,
  AuditAction,
  DiscountType,
  FulfillmentStatus,
  ImportJobStatus,
  ImportSourceType,
  InventoryPolicy,
  MediaType,
  NotificationChannel,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PostStatus,
  ProductStatus,
  ReviewStatus,
  ShipmentStatus,
  ShippingCarrier,
  UserStatus,
} from '@/generated/prisma/enums';

export type { Permission, RoleKey } from '@/constants/permissions';
export type { SessionUser } from '@/server/auth/session';
export type { Result } from '@/utils/result';
export * from '@/types/api';

/** Makes the listed keys required on an otherwise partial type. */
export type RequireKeys<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/** Recursively marks every property optional — useful for patch payloads. */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

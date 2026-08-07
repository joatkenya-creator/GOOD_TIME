# Cloudinary

Product imagery: upload, transform, deliver.

---

## Why the browser uploads directly

A 20MB product photo never passes through the Worker. The admin asks
`/api/admin/media/signature` for a short-lived signature, then `POST`s straight
to Cloudinary.

Two reasons. The Workers request body limit would reject the file outright, and
even where it would not, proxying a large upload through a metered runtime means
paying CPU-ms to copy bytes.

```
 admin browser              our Worker                 Cloudinary
      │  POST /signature        │                          │
      ├────────────────────────►│  sign(timestamp, folder) │
      │◄────── signature ───────┤                          │
      │                                                     │
      ├──────── POST file + signature ─────────────────────►│
      │◄──────────── public_id, secure_url ─────────────────┤
      │                         │                          │
      ├── save public_id ──────►│  Media row + checksum    │
```

The signature covers only `timestamp` and `folder` and is valid for one hour.
The upload preset in the Cloudinary dashboard is what constrains size, format
and dimensions — a signature that also encoded those would have to be rebuilt
every time the policy changed.

---

## Setup

1. Create a product environment at
   [console.cloudinary.com](https://console.cloudinary.com).
2. **Settings → Upload → Upload presets**, create `intimate-bunnie-products`:

   | Setting              | Value                  | Why                                                                           |
   | -------------------- | ---------------------- | ----------------------------------------------------------------------------- |
   | Signing mode         | **Signed**             | Unsigned is an open upload endpoint on the public internet                    |
   | Allowed formats      | `jpg, png, webp, avif` | No SVG — it can contain script, and it is served from a domain the CSP trusts |
   | Max file size        | 20 MB                  |                                                                               |
   | Max image dimensions | 4000 × 4000            | A 12000px original costs storage and transforms for detail nobody sees        |
   | Auto-tagging         | off                    |                                                                               |
   | Unique filename      | on                     | Stops one upload silently overwriting another                                 |
   | Overwrite            | off                    |                                                                               |

3. **Settings → Security**: restrict delivery to your domains, and enable
   _Strict transformations_ once the presets below are saved as named
   transformations. Without it, anyone can request arbitrary transformations
   against your account and bill you for them.

```bash
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud
```

The cloud name appears in every image URL and is not a secret. The API secret
signs uploads and deletions and never reaches the browser.

---

## Folders

```
products/{productId}/     one folder per product
brands/                   logos
collections/              collection hero images
blog/                     editorial
pages/                    CMS content
ui/                       placeholders, badges, email assets
```

Per-product folders rather than one flat `products/` directory, because deleting
a product then means deleting a folder. A flat namespace makes "which of these
forty thousand assets belonged to the discontinued line" unanswerable, and the
orphans accumulate as storage cost forever.

The allowed set is enforced by the Zod enum in
[`signature/route.ts`](../src/app/api/admin/media/signature/route.ts), so a
typo cannot create `prodcuts/`.

---

## Delivery and transformation

URLs are built by [`lib/performance/image.ts`](../src/lib/performance/image.ts).
Transformations live **in the URL**, never baked into the stored asset — so a
design change is a code change, not a re-upload of a hundred thousand images.

```
https://res.cloudinary.com/{cloud}/image/upload/f_auto,q_auto,w_640,c_fill/products/abc/main.jpg
                                                 └──────────── transformation ─────────────┘
```

### `f_auto` is the whole AVIF/WebP story

Cloudinary reads the `Accept` header and serves AVIF to browsers that take it,
WebP to the rest, JPEG to the remainder. There is no format negotiation to write
and no `<picture>` element to maintain — and it degrades correctly on a browser
released next year.

`q_auto` picks a quality per image by analysing content. A flat product shot on
white compresses far harder than a textured fabric close-up, and a fixed
`q_80` is either too heavy for the first or visibly poor on the second.

### Presets

| Use              | Transformation                             | `sizes`                                                 |
| ---------------- | ------------------------------------------ | ------------------------------------------------------- |
| Grid card        | `f_auto,q_auto,c_fill,g_auto,ar_3:4,w_480` | `(min-width:1280px) 25vw, (min-width:768px) 33vw, 50vw` |
| Product hero     | `f_auto,q_auto,c_fit,w_1200`               | `(min-width:1024px) 50vw, 100vw`                        |
| Zoom             | `f_auto,q_auto:best,w_2000`                | —                                                       |
| Cart thumbnail   | `f_auto,q_auto,c_fill,w_96,h_96`           | `96px`                                                  |
| Email            | `f_jpg,q_auto,w_600`                       | —                                                       |
| OG card          | `f_jpg,q_auto,c_fill,w_1200,h_630`         | —                                                       |
| Blur placeholder | `f_auto,q_30,w_24,e_blur:400`              | —                                                       |

Two of those are deliberately not `f_auto`:

- **Email** is `f_jpg`. Outlook does not render WebP or AVIF, and the image is
  simply missing — in a receipt, on a phone, with no way to recover.
- **OG cards** are `f_jpg` for the same reason: several social scrapers fetch
  without an `Accept` header at all.

### `sizes` is the single biggest LCP lever

Get it wrong and the browser downloads a 1920px image for a 320px slot. That is
usually a larger regression than anything else on the page, and it looks fine in
every screenshot.

### Blur placeholders

A 24px, heavily compressed, blurred version costs a few hundred bytes and
removes the layout shift that otherwise wrecks CLS on product grids.

---

## Lifecycle

### Deduplication

`media/pipeline.ts` hashes file content before upload. The same photo uploaded
for three variants is stored once — which matters when a supplier import brings
the same manufacturer image for forty SKUs.

### Deletion

Deleting a `Media` row does **not** delete the Cloudinary asset. That is
deliberate: an accidental product deletion is recoverable while the asset
survives, and unrecoverable once it does not.

Orphans are collected separately, on a delay:

```ts
// Assets with no Media row, older than 30 days.
await deleteAsset(publicId);
```

Thirty days is the window in which somebody notices and asks for it back.

### Backups

Cloudinary is the system of record for imagery. It is not backed up by Neon's
branching, and losing the account loses every product image.

- Enable **auto-backup** in the Cloudinary dashboard (Settings → Backup) to your
  own S3 or R2 bucket. This is the setting that matters and it is off by default.
- The database stores every `public_id`, so the mapping from product to asset
  survives independently of Cloudinary.

Covered in [disaster-recovery.md](./disaster-recovery.md).

---

## Cost

Billed on storage, transformations and bandwidth. Three things keep it down:

1. **`q_auto` and `f_auto`.** Typically 30–50% less bandwidth than a fixed
   `q_80` JPEG, for no visible difference.
2. **A bounded set of widths.** Every distinct transformation is a derived asset
   Cloudinary stores and bills. `deviceSizes` in `next.config.ts` is that list —
   adding arbitrary widths at call sites multiplies the derived-asset count.
3. **Cloudflare in front.** The cache rule in
   [cloudflare.md](./cloudflare.md#3-images) holds images at the edge for 30
   days, so a popular product image is fetched from Cloudinary once per region
   per month rather than once per visitor.

Watch **derived asset count** in the dashboard. A sudden rise means someone
introduced a per-request width.

---

## Alt text

Required, and enforced. `missingAltText()` in the media pipeline drives an admin
report, and the accessibility E2E spec fails the build on an `<img>` with no
`alt` attribute at all.

`alt=""` is correct for decoration. A _missing_ attribute makes a screen reader
read the filename aloud — which on a product image in this catalogue is a
sentence nobody wants read out.

---

## Troubleshooting

| Symptom                                 | Cause                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| 401 on upload                           | Signature expired (one hour) or the API secret is wrong                                       |
| 400 `Invalid image file`                | Format not in the preset's allowed list                                                       |
| Image 404s but the `public_id` is right | Wrong cloud name, or delivery is restricted to domains that do not include this one           |
| Transformations 401                     | Strict transformations is on and this one is not a saved named transformation                 |
| Images load slowly on first hit         | Normal — the derived asset is generated on demand and cached afterwards                       |
| CSP blocks the image                    | `res.cloudinary.com` missing from `img-src` in [`headers.ts`](../src/lib/security/headers.ts) |

import { type JsonLdObject } from '@/lib/seo/json-ld';
import { escapeJsonLd } from '@/lib/security/sanitize';

export interface JsonLdProps {
  /** One schema object, or several to emit as separate script tags. */
  schema: JsonLdObject | JsonLdObject[];
}

/**
 * Renders Schema.org JSON-LD.
 *
 * `escapeJsonLd` neutralises `<` so a product name containing `</script>` cannot
 * break out of the block — the one XSS vector that structured data introduces.
 */
export function JsonLd({ schema }: JsonLdProps) {
  const schemas = Array.isArray(schema) ? schema : [schema];

  return (
    <>
      {schemas.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: escapeJsonLd(entry) }}
        />
      ))}
    </>
  );
}

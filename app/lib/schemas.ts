import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(50),
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

const emptyToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const rupiah = z.coerce.number().int().min(0).max(1_000_000_000);
const qtyField = z.coerce.number().int().min(0).max(1_000_000);

export const variantInputSchema = z.object({
  id: z.uuid().optional(),
  sku: z.string().trim().min(1).max(50),
  barcode: emptyToNull(64),
  size: emptyToNull(30),
  color: emptyToNull(30),
  costPrice: rupiah,
  sellPrice: z.coerce.number().int().min(1).max(1_000_000_000),
  initialStock: qtyField,
  minQty: qtyField,
  isActive: z.boolean(),
});

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    categoryId: z
      .union([z.uuid(), z.literal("")])
      .transform((v) => (v === "" ? null : v)),
    isActive: z.boolean(),
    hasVariants: z.boolean(),
    variants: z.array(variantInputSchema).min(1).max(100),
  })
  .superRefine((value, ctx) => {
    if (!value.hasVariants && value.variants.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Produk tanpa varian harus punya tepat satu varian",
        path: ["variants"],
      });
    }
    const skus = new Set<string>();
    const barcodes = new Set<string>();
    value.variants.forEach((variant, index) => {
      const sku = variant.sku.toLowerCase();
      if (skus.has(sku)) {
        ctx.addIssue({
          code: "custom",
          message: "SKU ganda dalam satu produk",
          path: ["variants", index, "sku"],
        });
      }
      skus.add(sku);
      if (variant.barcode) {
        if (barcodes.has(variant.barcode)) {
          ctx.addIssue({
            code: "custom",
            message: "Barcode ganda dalam satu produk",
            path: ["variants", index, "barcode"],
          });
        }
        barcodes.add(variant.barcode);
      }
    });
  });

export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = ProductInput["variants"][number];

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

// Username akun harus cocok pola ini karena login mencari username secara
// persis (case-sensitive di server); seed men-normalisasi lowercase.
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, "3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung"),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["admin", "kasir"]),
  storeId: z
    .union([z.uuid(), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  password: z.string().min(8, "Password minimal 8 karakter").max(200),
  maxDiscountPct: z.coerce.number().int().min(0).max(100),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  userId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["admin", "kasir"]),
  storeId: z
    .union([z.uuid(), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  maxDiscountPct: z.coerce.number().int().min(0).max(100),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const setUserActiveSchema = z.object({
  userId: z.uuid(),
  active: z.enum(["aktif", "nonaktif"]).transform((v) => v === "aktif"),
});

export const resetPasswordSchema = z.object({
  userId: z.uuid(),
  password: z.string().min(8, "Password minimal 8 karakter").max(200),
});

export const storeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: emptyToNull(200),
});

// Payload retur sebagian: daftar baris (varian + jumlah) dan alasan.
// Jumlah uang dikembalikan dihitung ulang di server, tidak dipercaya dari klien.
export const returnInputSchema = z
  .object({
    saleId: z.uuid(),
    lines: z
      .array(
        z.object({
          variantId: z.uuid(),
          qty: z.coerce.number().int().min(1).max(10_000),
        }),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().min(3).max(200),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: "custom",
          message: "Produk ganda dalam retur",
          path: ["lines", index, "variantId"],
        });
      }
      seen.add(line.variantId);
    });
  });

export type ReturnInput = z.infer<typeof returnInputSchema>;

export const stockInSchema = z.object({
  variantId: z.uuid(),
  qty: z.coerce.number().int().min(1).max(1_000_000),
  reason: emptyToNull(200),
});

export const stockAdjustSchema = z.object({
  variantId: z.uuid(),
  qty: qtyField,
  reason: z.string().trim().min(3).max(200),
});

// Klien hanya mengirim produk, jumlah, diskon, dan uang diterima.
// Harga dan total selalu dihitung ulang di server.
export const saleInputSchema = z
  .object({
    clientId: z.uuid(),
    items: z
      .array(
        z.object({
          variantId: z.uuid(),
          qty: z.coerce.number().int().min(1).max(10_000),
        }),
      )
      .min(1)
      .max(100),
    discount: z.object({
      type: z.enum(["none", "percent", "amount"]),
      value: z.coerce.number().int().min(0).max(1_000_000_000),
    }),
    cashReceived: z.coerce.number().int().min(0).max(2_000_000_000),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code: "custom",
          message: "Produk ganda di keranjang",
          path: ["items", index, "variantId"],
        });
      }
      seen.add(item.variantId);
    });
    if (value.discount.type === "percent" && value.discount.value > 100) {
      ctx.addIssue({
        code: "custom",
        message: "Diskon persen maksimal 100",
        path: ["discount", "value"],
      });
    }
  });

export type SaleInput = z.infer<typeof saleInputSchema>;

export function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function describeZodError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Data tidak valid.";
  const path = issue.path.map(String).join(".") || "data";
  return `${path}: ${issue.message}`;
}
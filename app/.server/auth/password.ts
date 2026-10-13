import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const N = 16384;
const R = 8;
const P = 1;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N: n, r, p },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

let dummyHash: Promise<string> | null = null;

// Jika stored kosong (user tidak ada), tetap lakukan kerja hash
// supaya waktu respons tidak membocorkan keberadaan username.
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const hash = stored ?? (await (dummyHash ??= hashPassword("tidak-dipakai")));
  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");

  const actual = await derive(password, salt, n, r, p);
  const match =
    actual.length === expected.length && timingSafeEqual(actual, expected);

  return stored != null && match;
}
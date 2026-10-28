// auth.js: checks email + password against the shared Prime users table (dtbl_prime_users),
// the same table the prime-login project uses, so one set of credentials works for both.
import bcrypt from "bcrypt";

export function makeVerifyUser(db) {
  return async function verifyUser(email, password) {
    const [rows] = await db.query(
      "SELECT id, email, full_name, password_hash, is_active FROM dtbl_prime_users WHERE email = ? LIMIT 1",
      [email.trim().toLowerCase()]
    );
    const row = rows[0];
    // Always run a bcrypt compare so a missing user takes as long as a wrong password.
    const hash = row?.password_hash || "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const ok = await bcrypt.compare(password, hash).catch(() => false);
    if (!row || !ok || !row.is_active) return null;
    await db.query("UPDATE dtbl_prime_users SET last_login_utc = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
    return { email: row.email };
  };
}

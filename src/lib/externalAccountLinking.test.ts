import { expect, test } from "bun:test";
import { findVerifiedProviderAccount } from "../../supabase/functions/external-auth/accountLinking";

const account = { id: "existing-riskblue-user", email: "owner@example.com", email_confirmed_at: "2026-10-28T14:28:00Z" };

test("Autodesk verified email automatically selects the existing RiskBlue account", async () => {
  const result = await findVerifiedProviderAccount("autodesk", { email: "OWNER@example.com", emailVerified: true }, async () => [account]);
  expect(result?.id).toBe("existing-riskblue-user");
});

test("an unverified Autodesk email cannot auto-link", async () => {
  let lookedUp = false;
  const result = await findVerifiedProviderAccount("autodesk", { email: account.email, emailVerified: false }, async () => { lookedUp = true; return [account]; });
  expect(result).toBe(null);
  expect(lookedUp).toBe(false);
});

test("Procore verified email selects the same existing RiskBlue account as Autodesk", async () => {
  const result = await findVerifiedProviderAccount("procore", { email: "OWNER@example.com", emailVerified: true }, async () => [account]);
  expect(result?.id).toBe(account.id);
});

test("Procore unverified email cannot auto-link", async () => {
  let lookedUp = false;
  const result = await findVerifiedProviderAccount("procore", { email: account.email, emailVerified: false }, async () => { lookedUp = true; return [account]; });
  expect(result).toBe(null);
  expect(lookedUp).toBe(false);
});

test("an unconfirmed RiskBlue email is not eligible for auto-linking", async () => {
  const result = await findVerifiedProviderAccount("autodesk", { email: account.email, emailVerified: true }, async () => [{ ...account, email_confirmed_at: undefined }]);
  expect(result).toBe(null);
});

test("a different email cannot select another RiskBlue account", async () => {
  const result = await findVerifiedProviderAccount("autodesk", { email: "different@example.com", emailVerified: true }, async () => [account]);
  expect(result).toBe(null);
});

test("matching accounts beyond the first page remain discoverable", async () => {
  const pages: number[] = [];
  const result = await findVerifiedProviderAccount("autodesk", { email: account.email, emailVerified: true }, async page => {
    pages.push(page);
    return page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: `other-${i}`, email: `other-${i}@example.com` })) : [account];
  });
  expect(result?.id).toBe(account.id);
  expect(pages).toEqual([1, 2]);
});

test("Procore cannot auto-link an unconfirmed RiskBlue email", async () => {
  const result = await findVerifiedProviderAccount("procore", { email: account.email, emailVerified: true }, async () => [{ ...account, email_confirmed_at: undefined }]);
  expect(result).toBe(null);
});

test("unsupported providers cannot auto-link", async () => {
  const result = await findVerifiedProviderAccount("unknown", { email: account.email, emailVerified: true }, async () => [account]);
  expect(result).toBe(null);
});
import { ORG_ROLES, type OrgRole } from "@kerno/contracts";
import { describe, expect, it } from "vitest";
import { canChangeRole, canRemoveMember, roleAllows } from "./permissions";

describe("roleAllows", () => {
  it("matches the documented matrix", () => {
    expect(ORG_ROLES.filter((r) => roleAllows(r, "store.write"))).toEqual(["owner", "admin"]);
    expect(ORG_ROLES.filter((r) => roleAllows(r, "org.rename"))).toEqual(["owner"]);
    expect(ORG_ROLES.filter((r) => roleAllows(r, "audit.read"))).toEqual(["owner", "admin"]);
    expect(ORG_ROLES.filter((r) => roleAllows(r, "org.read"))).toEqual([...ORG_ROLES]);
  });
});

describe("canChangeRole", () => {
  it("lets owners change anything and admins only manager/staff -> manager/staff", () => {
    for (const from of ORG_ROLES) for (const to of ORG_ROLES) expect(canChangeRole("owner", from, to)).toBe(true);
    expect(canChangeRole("admin", "staff", "manager")).toBe(true);
    expect(canChangeRole("admin", "manager", "staff")).toBe(true);
  });

  it.each<[OrgRole, OrgRole]>([
    ["admin", "owner"],
    ["admin", "admin"],
    ["manager", "staff"],
    ["staff", "staff"],
  ])("denies %s acting on a %s", (actor, current) => {
    for (const to of ORG_ROLES) expect(canChangeRole(actor, current, to)).toBe(false);
  });

  it("denies an admin granting admin or owner (escalation)", () => {
    expect(canChangeRole("admin", "staff", "admin")).toBe(false);
    expect(canChangeRole("admin", "manager", "owner")).toBe(false);
  });
});

describe("canRemoveMember", () => {
  it("allows leaving, owner removals and admin removal of lower roles only", () => {
    for (const r of ORG_ROLES) expect(canRemoveMember(r, r, true)).toBe(true);
    expect(canRemoveMember("owner", "admin", false)).toBe(true);
    expect(canRemoveMember("admin", "staff", false)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(false);
    expect(canRemoveMember("admin", "owner", false)).toBe(false);
    expect(canRemoveMember("manager", "staff", false)).toBe(false);
    expect(canRemoveMember("staff", "staff", false)).toBe(false);
  });
});

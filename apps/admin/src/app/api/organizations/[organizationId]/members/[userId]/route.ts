import { handleMemberRemoval, handleMemberRoleChange } from "@kerno/server";
import { requestAuth } from "../../../../../../lib/auth";

interface Context {
  params: Promise<{ organizationId: string; userId: string }>;
}

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handleMemberRoleChange(request, await context.params, await requestAuth());
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handleMemberRemoval(request, await context.params, await requestAuth());
}

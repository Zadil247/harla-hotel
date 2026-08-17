export async function requestingAdmin(supabase, request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id, active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminError) {
    console.error("Harla admin authorization lookup failed", {
      code: adminError.code || "unknown_database_error",
      message: adminError.message || "The admin_users query failed.",
    });
    const diagnostic = new Error("Harla admin authorization lookup failed.", {
      cause: adminError,
    });
    diagnostic.code = "admin_authorization_lookup_failed";
    throw diagnostic;
  }

  return admin ? data.user : null;
}

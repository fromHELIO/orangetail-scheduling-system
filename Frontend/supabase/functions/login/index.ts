import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: "Username and password are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: user, error } = await supabaseAdmin.from("user").select("user_id, username, password_hash").eq("username", username).single();

    if (error || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return new Response(
        JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabaseAdmin.from("user").update({ last_login: new Date().toISOString() }).eq("user_id", user.user_id);

    return new Response(
      JSON.stringify({ user_id: user.user_id, username: user.username }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Something went wrong while logging in." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
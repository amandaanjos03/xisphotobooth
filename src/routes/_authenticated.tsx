import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext() as { user: { id: string; email?: string } };
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (cancelled) return;
      setIsAdmin(!error && !!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Você saiu da sua conta");
    router.navigate({ to: "/auth", replace: true });
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen grid place-items-center bg-blob">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-blob grid place-items-center px-4">
        <div className="card-soft p-8 max-w-md text-center">
          <h1 className="font-display text-2xl font-bold">Acesso de administrador necessário</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta ({user.email}) está conectada, mas não é administradora. Peça a um admin
            existente para conceder essa permissão.
          </p>
          <div className="mt-6 flex gap-2 justify-center">
            <Button asChild variant="secondary" className="rounded-full">
              <Link to="/">Início</Link>
            </Button>
            <Button onClick={signOut} className="rounded-full gap-1.5">
              <LogOut className="size-4" /> Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

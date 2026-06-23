import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import xisLogo from "@/assets/xis-logo.png.asset.json";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
  head: () => ({ meta: [{ title: "Redefinir senha — Xis Photo Booth" }] }),
});

function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase places the recovery tokens in the URL hash and creates a session.
    // We just need to wait until that happens.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("A senha precisa ter ao menos 8 caracteres");
    if (password !== confirm) return toast.error("As senhas não coincidem");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Senha redefinida com sucesso");
    router.navigate({ to: "/admin", replace: true });
  }

  return (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="w-full max-w-md card-soft p-8">
        <Link to="/" className="flex flex-col items-center gap-3 mb-6">
          <img src={xisLogo.url} alt="Xis Photo Booth" className="h-24 w-auto" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Redefinir senha</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Escolha uma nova senha para acessar o painel.
        </p>

        {!ready ? (
          <div className="mt-8 grid place-items-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <p className="mt-3 text-sm">Validando link de recuperação…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label htmlFor="pw">Nova senha</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Confirme a nova senha</Label>
              <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
            <Button type="submit" disabled={busy} className="w-full rounded-full">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Redefinir senha"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

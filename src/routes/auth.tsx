import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
  head: () => ({ meta: [{ title: "Entrar — Xis Photo Booth" }] }),
});

function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.navigate({ to: "/admin", replace: true });
    });
  }, [router]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Você entrou com sucesso");
    router.navigate({ to: "/admin", replace: true });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      "Conta criada. Peça a um administrador existente para conceder permissão de admin.",
    );
  }

  return (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="w-full max-w-md card-soft p-8">
        <Link to="/" className="inline-flex items-center gap-2 mb-6">
          <span className="grid place-items-center size-9 rounded-2xl bg-primary text-primary-foreground">
            <Camera className="size-5" />
          </span>
          <span className="font-display text-xl font-bold">Xis Photo Booth</span>
        </Link>
        <h1 className="font-display text-3xl font-bold">Acesso do administrador</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entre para gerenciar eventos. Convidados não precisam de conta para usar a cabine.
        </p>

        <Tabs defaultValue="signin" className="mt-6">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={signIn} className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label htmlFor="email-in">E-mail</Label>
                <Input id="email-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-in">Senha</Label>
                <Input id="pw-in" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              <Button type="submit" disabled={busy} className="w-full rounded-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Entrar"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={signUp} className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label htmlFor="email-up">E-mail</Label>
                <Input id="email-up" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-up">Senha</Label>
                <Input id="pw-up" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" minLength={8} />
              </div>
              <Button type="submit" disabled={busy} variant="secondary" className="w-full rounded-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Criar conta"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Novas contas não têm permissão de admin. Um administrador existente precisa concedê-la.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import xisLogo from "@/assets/xis-logo.png.asset.json";

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
  const [forgotOpen, setForgotOpen] = useState(false);

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
      "Conta criada! Verifique seu e-mail para confirmar e ativar o acesso de administrador.",
    );
  }

  return (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="w-full max-w-md card-soft p-8">
        <Link to="/" className="flex flex-col items-center gap-3 mb-6">
          <img src={xisLogo.url} alt="Xis Photo Booth" className="h-24 w-auto" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Acesso do administrador</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entre para gerenciar seus eventos. Convidados não precisam de conta para usar a cabine.
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="pw-in">Senha</Label>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
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
                Após confirmar seu e-mail, você terá acesso para criar seus próprios eventos.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} initialEmail={email} />
    </div>
  );
}

function ForgotPasswordDialog({
  open, onOpenChange, initialEmail,
}: { open: boolean; onOpenChange: (o: boolean) => void; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setEmail(initialEmail); }, [open, initialEmail]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Enviamos um link de recuperação para o seu e-mail.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Recuperar senha</DialogTitle>
          <DialogDescription>
            Informe o e-mail da sua conta. Enviaremos um link para você redefinir sua senha.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-forgot">E-mail</Label>
            <Input id="email-forgot" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy} className="rounded-full">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Enviar link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

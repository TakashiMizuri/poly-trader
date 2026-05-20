import { useCallback, useState, type ReactNode } from "react";

import { getStoredToken, setStoredToken } from "../api/client";

import { LiveProvider } from "../api/live";

import { AuthProvider } from "../api/auth";

import { clearAllPollCaches } from "../api/poll-cache";

import { motionEnter } from "@/lib/motion";

import { cn } from "@/lib/utils";

import { BrandLogo } from "@/components/brand-logo";

import { Btn } from "./app-ui";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Input } from "@/components/ui/input";



export function AuthGate({ children }: { children: ReactNode }) {

  const [token, setToken] = useState(getStoredToken);

  const [draft, setDraft] = useState(token);

  const [saved, setSaved] = useState(!!token);



  const logout = useCallback(() => {

    setStoredToken("");

    setToken("");

    setSaved(false);

    setDraft("");

    clearAllPollCaches();

  }, []);



  if (saved && token) {

    return (

      <AuthProvider logout={logout}>

        <LiveProvider>{children}</LiveProvider>

      </AuthProvider>

    );

  }



  return (

    <AuthProvider logout={logout}>

      <div className="flex min-h-screen items-center justify-center bg-background p-6">

        <Card

          className={cn(

            "w-full max-w-md border border-border shadow-2xl ring-0",

            motionEnter,

            "animate-in zoom-in-95 duration-500 fill-mode-both"

          )}

        >

          <CardHeader className="px-6 pt-6 pb-2">

            <CardTitle className="text-3xl">

              <BrandLogo />

            </CardTitle>

          </CardHeader>

          <CardContent className="px-6 pb-6">

            <p className="text-sm text-muted-foreground">

              Enter your <code className="font-mono text-xs text-primary">WEB_API_TOKEN</code> from{" "}

              <code className="font-mono text-xs text-zinc-300">.env</code>. Stored in this browser only.

            </p>

            <form

              className="mt-6 space-y-4"

              onSubmit={(e) => {

                e.preventDefault();

                const t = draft.trim();

                setStoredToken(t);

                setToken(t);

                setSaved(true);

              }}

            >

              <Input

                type="password"

                placeholder="API token"

                value={draft}

                onChange={(e) => setDraft(e.target.value)}

                autoComplete="off"

              />

              <Btn type="submit" variant="primary" disabled={!draft.trim()} className="w-full">

                Connect

              </Btn>

            </form>

          </CardContent>

        </Card>

      </div>

    </AuthProvider>

  );

}


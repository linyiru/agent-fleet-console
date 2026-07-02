import { FormEvent, useState } from "react";
import { KeyRound, LogIn } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { CardContent, CardDescription, CardForm, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";

export function AuthPrompt() {
  const [token, setToken] = useState(window.localStorage.getItem("hermesConsoleToken") || "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextToken = token.trim();
    if (!nextToken) return;
    window.localStorage.setItem("hermesConsoleToken", nextToken);
    window.location.reload();
  }

  return (
    <main className="auth-page">
      <CardForm className="auth-card" onSubmit={submit}>
        <CardHeader>
          <div>
            <CardTitle>Console authentication</CardTitle>
            <CardDescription>Enter the token configured in this console environment, or open the sign-in link the console prints at startup.</CardDescription>
          </div>
          <KeyRound />
        </CardHeader>
        <CardContent className="padded auth-form">
          <Field>
            <FieldLabel htmlFor="console-token">Access token</FieldLabel>
            <Input
              id="console-token"
              autoFocus
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="HERMES_CONSOLE_TOKEN"
            />
            <FieldDescription>Stored locally in this browser and sent as a bearer token to the API.</FieldDescription>
          </Field>
          <Button disabled={!token.trim()}>
            <LogIn data-icon="inline-start" />
            Continue
          </Button>
        </CardContent>
      </CardForm>
    </main>
  );
}

import { auth0 } from "@/lib/auth0";
import HeaderClient from "./HeaderClient";

export default async function AuthHeader() {
  const session = await auth0.getSession();
  const user = session?.user
    ? { sub: session.user.sub, picture: session.user.picture ?? null, name: session.user.name ?? null, email: session.user.email ?? null }
    : null;
  return <HeaderClient user={user} />;
}

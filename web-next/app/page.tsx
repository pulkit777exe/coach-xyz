import { auth0 } from "@/lib/auth0";
import AppClient from "@/components/AppClient";

export const metadata = {
  title: "CoachXYZ | AI Sports Form Analysis",
};

export default async function Home() {
  const session = await auth0.getSession();
  const auth0Id = session?.user?.sub ?? null;

  return <AppClient auth0Id={auth0Id} />;
}

import { getUserContext } from "@/server/user/context";

export default async function HomePage() {
  const { user } = await getUserContext();
  return (
    <div className="grid gap-3">
      <h2 className="text-lg font-semibold">Hi {user.name.split(" ")[0]}</h2>
      <p className="text-sm text-muted-foreground">Dashboard lands in the next phase.</p>
    </div>
  );
}

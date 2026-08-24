import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Compass className="size-6" />
      </div>
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold">Nothing here</h1>
        <p className="text-sm text-muted-foreground">
          That page doesn&apos;t exist, or it moved.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}

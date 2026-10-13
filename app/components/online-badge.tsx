import { Badge } from "~/components/ui/badge";
import { useOnline } from "~/lib/offline/use-online";

export function OnlineBadge() {
  const online = useOnline();
  return (
    <Badge variant={online ? "secondary" : "destructive"}>
      {online ? "Online" : "Offline"}
    </Badge>
  );
}
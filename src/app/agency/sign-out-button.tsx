import { Icon } from "@/components/icons";
import { agencySignOutAction } from "./actions";

export function AgencySignOut() {
  return (
    <form action={agencySignOutAction}>
      <button type="submit" className="btn btn-quiet">
        <Icon name="signOut" size={18} />
        Sign out
      </button>
    </form>
  );
}

import RequireAuth from "@/components/auth/RequireAuth";
import TextPostEditor from "@/components/add/TextPostEditor";

export default function AddTextPage() {
  return (
    <RequireAuth>
      <TextPostEditor />
    </RequireAuth>
  );
}

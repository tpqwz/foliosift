import { createFileRoute, Link } from "@tanstack/react-router";
import { PersonaPage, usePersonaEntities } from "@/components/library/personas-view";
import { Shell } from "@/components/library/shell";
import { entityBySlug } from "@/lib/persona/identity";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/personas/$slug")({
  component: PersonaRoute,
});

function PersonaRoute() {
  const { slug } = Route.useParams();
  const { works } = useLibrary();
  const entities = usePersonaEntities(works);
  const person = entityBySlug(entities, slug);

  return (
    <Shell>
      {person ? (
        <PersonaPage name={person.label} works={person.works} aliases={person.aliases} />
      ) : (
        <div>
          <p className="font-serif text-xl text-muted">No persona by that name is in the library.</p>
          <Link to="/personas" className="mt-3 inline-flex h-11 items-center text-sm text-accent">
            All personas
          </Link>
        </div>
      )}
    </Shell>
  );
}
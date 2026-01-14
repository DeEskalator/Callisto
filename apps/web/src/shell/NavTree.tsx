import { Link } from '@tanstack/react-router';
import { useConflicts } from '../app/queries';
import type { NavGroup } from './navigation';

/** The navigation pane: the destinations of the application, grouped by area. */
export function NavTree(props: { navigation: NavGroup[] }) {
  const conflicts = useConflicts().data?.length ?? 0;
  return (
    <nav className="nav" aria-label="Bereiche">
      {props.navigation.map((group) => (
        <div key={group.title}>
          <div className="nav__group">{group.title}</div>
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="nav__item"
              activeOptions={{ exact: true }}
              draggable={false}
            >
              <item.icon />
              <span className="nav__label">{item.label}</span>
              {item.to === '/kalender' && conflicts > 0 && (
                <span
                  className="nav__badge"
                  title="Gebuchte Termine in Schließzeiten oder an Feiertagen"
                >
                  {conflicts}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

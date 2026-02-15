import { Link } from '@tanstack/react-router';
import type { AppPath, NavGroup } from './navigation';

/** A navigation pane: destinations grouped by area, optionally with a counter next to them. */
export function NavTree(props: {
  label: string;
  navigation: NavGroup[];
  /** Numbers to show next to destinations, e.g. how many inquiries are open. */
  badges?: Partial<Record<AppPath, { count: number; title: string }>>;
}) {
  return (
    <nav className="nav" aria-label={props.label}>
      {props.navigation.map((group) => (
        <div key={group.title}>
          <div className="nav__group">{group.title}</div>
          {group.items.map((item) => {
            const badge = props.badges?.[item.to];
            return (
              <Link
                key={item.to}
                to={item.to}
                className="nav__item"
                activeOptions={{ exact: true }}
                draggable={false}
              >
                <item.icon />
                <span className="nav__label">{item.label}</span>
                {badge && badge.count > 0 && (
                  <span className="nav__badge" title={badge.title}>
                    {badge.count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

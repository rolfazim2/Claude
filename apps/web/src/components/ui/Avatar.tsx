import type { User } from '@taskflow/shared';
import clsx from 'clsx';

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function Avatar({ user, size = 22 }: { user?: User; size?: number }) {
  if (!user) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-hover text-faint"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        title="Не назначен"
      >
        ?
      </div>
    );
  }
  return (
    <div
      className={clsx('flex items-center justify-center rounded-full font-semibold text-white')}
      style={{ width: size, height: size, fontSize: size * 0.4, background: user.avatarColor ?? '#5e6ad2' }}
      title={user.fullName}
    >
      {initials(user.fullName)}
    </div>
  );
}

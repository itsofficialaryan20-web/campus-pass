import { Link } from 'react-router-dom';
import { Compass, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../lib/roles';
import { Button } from '../components/ui';

function Wrap({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  const { user } = useAuth();
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">{icon}<h1 className="text-xl font-bold">{title}</h1><p className="text-sm text-ink-2">{text}</p>
        <Link to={user ? homeFor(user.role) : '/login'}><Button>Go to my dashboard</Button></Link></div>
    </div>
  );
}
export const NotFoundPage = () => <Wrap icon={<Compass className="mx-auto h-10 w-10 text-ink-muted" />} title="Page not found" text="That page does not exist or was moved." />;
export const AccessDeniedPage = () => <Wrap icon={<ShieldAlert className="mx-auto h-10 w-10 text-danger-solid" />} title="Access denied" text="Your role does not allow this page. If you think this is a mistake, contact the administrator." />;

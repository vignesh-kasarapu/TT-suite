// The route table on its own so the route-coverage unit test (D-087) can read it without a DOM;
// App.tsx turns it into the browser router.
import type { RouteObject } from 'react-router';
import { Shell } from './Shell';
import { AppError, NotFound, PermissionDenied, RequireRole } from './pages';
import { MyOrgBoard, PrivateBoard, TeamBoard, UnassignedBoard } from './cards/Board';
import { Inbox } from './cards/Inbox';
import { Reports } from './org/Reports';
import { CardRoute } from './cards/CardDetail';
import { ProgramPage, ProgramsPage, ProjectPage } from './org/pages';
import { TeamsPage } from './org/Teams';
import { SearchPage } from './org/Search';
import {
  AdminPage,
  AdminPrograms,
  AdminProjects,
  AdminTags,
  AdminTeamDetail,
  AdminTeams,
  AdminUsers,
} from './admin/AdminPage';
import { AdminLoginIssues } from './admin/LoginIssues';
import { AdminMailTemplates } from './admin/MailTemplates';
import { AuthGate } from './auth/AuthGate';
import { SignIn } from './pages/auth/SignIn';
import { Expired, Refused, SignedOut } from './pages/auth/States';
import { Preferences } from './pages/Preferences';
import { MyTime } from './time/MyTime';
import { TeamTime } from './time/TeamTime';

const admin = (el: React.ReactNode) => <RequireRole need="admin">{el}</RequireRole>;
const manage = (el: React.ReactNode) => <RequireRole need="manage">{el}</RequireRole>;

export const routes: RouteObject[] = [
  // No session needed.
  { path: '/sign-in', element: <SignIn />, errorElement: <AppError /> },
  { path: '/refused', element: <Refused />, errorElement: <AppError /> },
  { path: '/signed-out', element: <SignedOut />, errorElement: <AppError /> },
  { path: '/expired', element: <Expired />, errorElement: <AppError /> },
  {
    element: <AuthGate />,
    errorElement: <AppError />,
    children: [
      {
        path: '/',
        element: <Shell />,
        children: [
          {
            path: '/',
            element: <PrivateBoard />,
            children: [
              { path: 'cards/:key', element: <CardRoute /> },
              { path: 'backlog', children: [{ path: 'cards/:key', element: <CardRoute /> }] },
              { path: 'calendar' }, // D-150: the board's Calendar tab
            ],
          },
          {
            path: 'org',
            element: <MyOrgBoard />,
            children: [
              { path: 'cards/:key', element: <CardRoute /> },
              { path: 'backlog', children: [{ path: 'cards/:key', element: <CardRoute /> }] },
              { path: 'calendar' }, // D-150: the board's Calendar tab
            ],
          },
          { path: 'inbox', element: <Inbox /> },
          { path: 'teams', element: <TeamsPage /> },
          {
            path: 'teams/:teamId',
            element: <TeamBoard />,
            children: [
              { path: 'cards/:key', element: <CardRoute /> },
              { path: 'backlog', children: [{ path: 'cards/:key', element: <CardRoute /> }] },
              { path: 'calendar' }, // D-150: the board's Calendar tab
            ],
          },
          {
            path: 'unassigned',
            element: <UnassignedBoard />,
            children: [
              { path: 'cards/:key', element: <CardRoute /> },
              { path: 'backlog', children: [{ path: 'cards/:key', element: <CardRoute /> }] },
              { path: 'calendar' }, // D-150: the board's Calendar tab
            ],
          },
          { path: 'programs', element: <ProgramsPage /> },
          { path: 'programs/:id', element: <ProgramPage /> },
          { path: 'projects/:id', element: <ProjectPage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'reports', element: <Reports /> },
          { path: 'time', element: <MyTime /> },
          { path: 'team-time', element: manage(<TeamTime />) },
          { path: 'preferences', element: <Preferences /> },
          { path: 'permission-denied', element: <PermissionDenied /> },
          {
            path: 'admin',
            element: manage(<AdminPage />),
            children: [
              { index: true, element: <AdminTeams /> },
              { path: 'teams/:id', element: <AdminTeamDetail /> },
              { path: 'programs', element: admin(<AdminPrograms />) },
              { path: 'projects', element: <AdminProjects /> },
              { path: 'tags', element: admin(<AdminTags />) },
              { path: 'users', element: admin(<AdminUsers />) },
              { path: 'mail-templates', element: admin(<AdminMailTemplates />) },
              { path: 'login-issues', element: admin(<AdminLoginIssues />) },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

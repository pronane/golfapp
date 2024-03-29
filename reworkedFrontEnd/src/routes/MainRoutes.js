import { lazy } from 'react';
import MainLayout from 'layout/MainLayout';
import Loadable from 'ui-component/Loadable';

const DashboardDefault = Loadable(lazy(() => import('views/dashboard')));
const Competition = Loadable(lazy(() => import('views/competition')));
const ViewCompetition = Loadable(lazy(() => import('views/competition/viewCompetition')));
const EventCompetition = Loadable(lazy(() => import('views/competition/eventCompetition')));
const PlayerCompetition = Loadable(lazy(() => import('views/competition/playerCompetition')));
const ViewGolfEvent = Loadable(lazy(() => import('views/golf/viewGolfEvent')));
const CreateGolfEvent = Loadable(lazy(() => import('views/golf/createGolfEvent')));
const ScoreCard = Loadable(lazy(() => import('views/golf/scoreCard')));
const ScoreCardView = Loadable(lazy(() => import('views/golf/scoreCardView')));
const EventScoreCardView = Loadable(lazy(() => import('views/golf/eventScoreCard')));
const Leaderboard = Loadable(lazy(() => import('views/golf/leaderboard')));

const MainRoutes = {
  path: '/',
  element: <MainLayout />,
  children: [
    {
      path: '/',
      element: <DashboardDefault />
    },
    {
      path: 'dashboard',
      children: [
        {
          path: '',
          element: <DashboardDefault />
        }
      ]
    },
    {
      path: 'competition',
      children: [
        {
          path: '',
          element: <Competition />
        },
        {
          path: 'view',
          element: <ViewCompetition />
        },
        {
          path: 'events',
          element: <EventCompetition />
        },
        {
          path: 'registerplayers',
          element: <PlayerCompetition />
        }
      ]
    },
    {
      path: 'golf',
      children: [
        {
          path: '',
          element: <Competition />
        },
        {
          path: 'view',
          element: <ViewGolfEvent />
        },
        {
          path: 'createevent',
          element: <CreateGolfEvent />
        },
        {
          path: 'scorecard',
          element: <ScoreCard />
        },
        {
          path: 'scorecardview/:eventId/:groupNumber',
          element: <EventScoreCardView />
        },
        {
          path: 'fullscorecardview/:eventId/:groupNumber',
          element: <ScoreCardView />
        },
        {
          path: 'leaderboard',
          element: <Leaderboard />
        }
      ]
    }
  ]
};

export default MainRoutes;

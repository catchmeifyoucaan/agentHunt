# AgentHunt Frontend

Modern, responsive web dashboard for AgentHunt Security Orchestration Platform.

## Features

- **Dashboard**: Real-time overview of programs, jobs, findings, and queue status
- **Manager AI Chat**: Conversational interface for orchestrating security scans
- **Live Terminal**: Real-time log streaming with color-coded output
- **Findings Browser**: Sortable, filterable vulnerability viewer
- **Programs Management**: Create and manage bug bounty programs
- **Jobs Monitor**: Track active, pending, and completed jobs

## Tech Stack

- **Next.js 14** with App Router
- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **TanStack Query** for data fetching
- **WebSocket** for real-time updates
- **Recharts** for data visualization
- **React Markdown** for AI responses

## Getting Started

### Prerequisites

- Node.js 20+
- Backend API running on port 3000

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:3001

### Production Build

```bash
npm run build
npm start
```

## Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000
```

## Project Structure

```
frontend/
├── app/                 # Next.js App Router pages
│   ├── dashboard/      # Dashboard page
│   ├── chat/           # Manager AI chat interface
│   ├── terminal/       # Live terminal viewer
│   ├── findings/       # Findings browser
│   ├── programs/       # Programs management
│   └── jobs/           # Jobs monitor
├── components/          # React components
│   ├── layout/         # Layout components (Sidebar, Header)
│   ├── ui/             # Reusable UI components
│   └── features/       # Feature-specific components
├── lib/                # Utility libraries
│   ├── api.ts          # API client
│   └── utils.ts        # Helper functions
└── hooks/              # Custom React hooks
    └── useWebSocket.ts # WebSocket hook
```

## Key Features

### Real-Time WebSocket Events

```typescript
import { useEventStream } from '@/hooks/useWebSocket';

const { events, isConnected } = useEventStream({
  programId: 'program-id', // optional filter
});
```

### API Client

```typescript
import { programsApi, jobsApi, managerApi } from '@/lib/api';

// Get programs
const { data } = useQuery({
  queryKey: ['programs'],
  queryFn: () => programsApi.list(),
});

// Create job
const mutation = useMutation({
  mutationFn: (data) => jobsApi.create(data),
});

// Send Manager AI command
const command = await managerApi.sendCommand({
  command: 'Start discovery for program X',
  program_id: 'uuid',
  user_id: 'user-id',
});
```

## Pages

### Dashboard (`/dashboard`)
- Overview statistics
- Recent jobs and findings
- Queue status
- Quick actions

### Chat (`/chat`)
- Conversational Manager AI
- Command history
- Action execution tracking
- Program selector

### Terminal (`/terminal`)
- Real-time log streaming
- Filterable by program, level
- Color-coded output
- Export logs

### Findings (`/findings`)
- Sortable findings table
- Filter by severity, status
- PoC preview
- Status management

## Styling

Uses Tailwind CSS with custom design system:

- **Colors**: Defined in `tailwind.config.js`
- **Dark Mode**: Class-based dark mode support
- **Components**: Custom component library in `components/ui/`

## Performance

- **React Query**: Automatic caching and revalidation
- **WebSocket**: Efficient real-time updates
- **Code Splitting**: Automatic route-based splitting
- **SSR**: Server-side rendering for initial load

## Contributing

1. Follow TypeScript strict mode
2. Use Tailwind for styling
3. Add proper types for all props
4. Test WebSocket connections
5. Ensure responsive design

## License

MIT License - See LICENSE file

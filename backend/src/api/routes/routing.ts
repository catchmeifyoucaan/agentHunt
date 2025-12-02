import { Router } from 'express';
import { ROUTING_RULES } from '../../services/dynamic-handoff-router';

const router = Router();

// Get current routing rules
router.get('/rules', (req, res) => {
  try {
    // Convert the Record to a more frontend-friendly format
    const rules = Object.entries(ROUTING_RULES).map(([signalType, targets]) => ({
      signalType,
      targets: targets.map(t => ({
        agents: t.agents,
        priority: t.priority,
        hasCondition: !!t.condition
      }))
    }));

    res.json({ rules });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

const { AuditLog } = require('../models');

/** LMS-079/NFR-12: every state transition, config change, adjustment, delegation and admin action. */
async function record({ actorId, isSystemActor = false, action, entityType, entityId, priorValue, newValue, transaction }) {
  return AuditLog.create({
    actor_id: actorId ?? null,
    is_system_actor: isSystemActor,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    prior_value: priorValue != null ? JSON.stringify(priorValue) : null,
    new_value: newValue != null ? JSON.stringify(newValue) : null,
    timestamp: new Date(),
  }, { transaction });
}

module.exports = { record };

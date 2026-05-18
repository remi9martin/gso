// Role taxonomy for the override dropdown.
// Source of truth: GSO-29 spec "Role Taxonomy" table.
// Short descriptions are condensed from the spec "Handles" column so each
// dropdown row stays scannable (~5 words).

import type { AgentRole } from './types';

export interface RoleInfo {
  role: AgentRole;
  // Agent-name as shown to the board user (kebab-cased role → PascalCase agent name).
  agentName: string;
  // Plain title (matches the Role Taxonomy "Agent" column).
  title: string;
  // Short description, used in dropdown items.
  description: string;
}

export const ROLE_CATALOG: Record<AgentRole, RoleInfo> = {
  cto: {
    role: 'cto',
    agentName: 'CTO',
    title: 'CTO',
    description: 'Architecture, security, infra'
  },
  founding_engineer: {
    role: 'founding_engineer',
    agentName: 'FoundingEngineer',
    title: 'Founding Engineer',
    description: 'Features, bugs, deploys'
  },
  ux_designer: {
    role: 'ux_designer',
    agentName: 'UXDesigner',
    title: 'UX Designer',
    description: 'Design, accessibility, flows'
  },
  ceo: {
    role: 'ceo',
    agentName: 'CEO',
    title: 'CEO',
    description: 'Strategy, GTM, approvals'
  }
};

export const ALL_ROLES: AgentRole[] = ['cto', 'founding_engineer', 'ux_designer', 'ceo'];

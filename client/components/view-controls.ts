import type { WorkflowState } from '../stores/workflow';

export const degreesToRadians = (degrees: number) => degrees * Math.PI / 180;
export const radiansToDegrees = (radians: number) => radians * 180 / Math.PI;
export const canUpdateViewPose = (workflow: WorkflowState) => workflow === 'viewing';

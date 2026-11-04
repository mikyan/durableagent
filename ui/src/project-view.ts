import type {PositionState} from '../../runtime/src/project-protocol';
export const positionLabels:Record<PositionState['state'],string>={available:'位置可用',unverified:'位置尚未核验',missing:'目录不存在',revoked:'目录访问已撤销','environment-changed':'执行环境已变化',ambiguous:'目录身份尚未明确'};

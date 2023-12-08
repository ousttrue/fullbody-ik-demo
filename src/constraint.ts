import * as THREE from 'three';
import {
  Joint, ConstrainType, JointType, FArray3, Bone, Constrain, ConstrainName, Priority, PriorityName
} from './def';
import {
  getJointOrientation, getJointWorldMatrix, solveJacobianIk, getJointWorldPosition
} from './ik';
import {
  rotWrap, SliderAngleFloat3, initImGui, endImGui, beginImGui
} from "./gui";
import { mul, rotXYZ, getRotationXYZ, identity, cancelScaling, cancelTranslate } from './math-util';


/**
 * ボーンにジョイントの値を適用
 * @param joints ジョイント
 * @param bones ボーン(出力)
 */
function applyJointsToBones(joints: Joint[], bones: Bone[]): void {
  joints.forEach((joint, i) => {
    if (joint.type === JointType.Revolution) {
      bones[joint.boneIndex].rotation[joint.axis] = joint.value;
    }
    else if (joint.type === JointType.Slide) {
      bones[joint.boneIndex].offset[joint.axis] = joint.value;
    }
  });
}


/**
 * ベクトルを配列に変換
 * @param vec ベクトル
 * @returns 配列
 */
export function convertVector3ToArray(vec: THREE.Vector3 | THREE.Euler): FArray3 {
  return [vec.x, vec.y, vec.z];
}


/**
 * ボーンに対応するジョイントを取得
 * @param joints ジョイント
 * @param boneIndex 取得したいボーン
 * @returns ジョイントインデックス
 */
export function convertBoneToJointIndex(joints: Joint[], boneIndex: number): number {
  // ボーンに対応する一番最後のジョイントを選ぶ
  for (const [index, joint] of [...joints.entries()].reverse()) {
    if (joint.boneIndex === boneIndex) {
      return index;
    }
  }
  return -1;
}


/**
 * 回転と移動を分解してジョイントに変換
 * @param bones ボーン
 * @returns ジョイント
 */
export function convertBonesToJoints(bones: Bone[]): Joint[] {
  const joints: Joint[] = [];
  const indices: number[] = [];
  bones.forEach((bone, i) => {
    let parent = (() => { let j = 0; return () => j++ === 0 && indices[bone.parentIndex] !== undefined ? indices[bone.parentIndex] : joints.length - 1; })();

    if (bone.static) {
      joints.push({ boneIndex: i, type: JointType.Static, axis: 0, value: 0, offset: bone.offset, scale: bone.scale, rotation: bone.rotation, parentIndex: parent(), dirty: true, world: identity(4) });
    }
    else {
      // value = 関節変位 q
      // スライダジョイントを挿入
      if (bone.slide) {
        joints.push({ boneIndex: i, type: JointType.Slide, axis: 0, value: bone.offset[0], offset: [0, 0, 0], scale: [1, 1, 1], parentIndex: parent(), dirty: true, world: identity(4) });
        joints.push({ boneIndex: i, type: JointType.Slide, axis: 1, value: bone.offset[1], offset: [0, 0, 0], scale: [1, 1, 1], parentIndex: parent(), dirty: true, world: identity(4) });
        joints.push({ boneIndex: i, type: JointType.Slide, axis: 2, value: bone.offset[2], offset: [0, 0, 0], scale: [1, 1, 1], parentIndex: parent(), dirty: true, world: identity(4) });
      }

      // XYZ回転
      let offset: FArray3 = bone.slide ? [0, 0, 0] : bone.offset;
      joints.push({ boneIndex: i, type: JointType.Revolution, axis: 0, value: bone.rotation[0], offset: offset, scale: [1, 1, 1], parentIndex: parent(), dirty: true, world: identity(4) });
      joints.push({ boneIndex: i, type: JointType.Revolution, axis: 1, value: bone.rotation[1], offset: [0, 0, 0], scale: [1, 1, 1], parentIndex: parent(), dirty: true, world: identity(4) });
      joints.push({ boneIndex: i, type: JointType.Revolution, axis: 2, value: bone.rotation[2], offset: [0, 0, 0], scale: bone.scale, parentIndex: parent(), dirty: true, world: identity(4) });
    }
    indices[i] = joints.length - 1;
  });
  return joints;
}


export class Constraint {
  settings = {
    animation: true,
    debugDisp: false,
  };

  bones: Bone[] = [];
  constrains: Constrain[] = [
    { priority: Priority.High, bone: 15, joint: -1, pos: [0.5, 1.5, 0], object: undefined, type: ConstrainType.Position, enable: true },
    { priority: Priority.High, bone: 15, joint: -1, rot: [-0.5, -0.2, -0.2], object: undefined, type: ConstrainType.Orientation, enable: false },
    { priority: Priority.High, bone: 11, joint: -1, pos: [-0.5, 1.5, 0], object: undefined, type: ConstrainType.Position, enable: false },
    { priority: Priority.Low, bone: 6, joint: -1, base_rot: [0, 0, 0], bounds: { gamma_max: Math.PI / 4 }, object: undefined, type: ConstrainType.OrientationBound, enable: false },
  ];

  /*
  const constrains: Constrain[] = [
    {priority: 1, bone: 2, joint: -1, pos: [1,1,0], object: undefined, type: ConstrainType.Position, enable: true},
    {priority: 0, bone: 2, joint: -1, rot: [1,0,0], object: undefined, type: ConstrainType.Orientation, enable: true},
    {priority: 0, bone: 2, joint: -1, bounds: {gamma_max: Math.PI/4}, base_rot: [0,0,0], object: undefined, type: ConstrainType.OrientationBound, enable: true},
    {priority: 0, bone: 0, joint: -1, bounds: {gamma_max: Math.PI/4}, base_rot: [0,0,0], object: undefined, type: ConstrainType.OrientationBound, enable: true},
    {priority: 1, bone: 4, joint: -1, pos: [-1,1,0], object: undefined, type: ConstrainType.Position, enable: true}
  ];
  
  const bones: Bone[] = [];
  const root: Bone = {
    offset: [0,0,0],
    rotation: [0,0,0],
    scale: [1,1,1],
    slide: false, // ik計算用スライドジョイントフラグ
    parentIndex: -1,
    children: [{
        offset: [0.5,1,0],
        rotation: [0,0,0],
        scale: [1,1,1],
        parentIndex: -1,
        children: [{
          offset: [0,1,0],
          rotation: [0,0,0],
          scale: [1,1,1],
          parentIndex: -1,
          children: []
        }]
      },
      {
        offset: [-0.5,1,0],
        rotation: [0,0,0],
        scale: [1,1,1],
        parentIndex: -1,
        children: [{
          offset: [0,1,0],
          rotation: [0,0,0],
          scale: [1,1,1],
          parentIndex: -1,
          children: []
        }]
      },
      {
        offset: [0.5,0,0],
        rotation: [Math.PI,0,0],
        scale: [1,1,1],
        parentIndex: -1,
        children: [{
          offset: [0,1,0],
          rotation: [0,0,0],
          scale: [1,1,1],
          parentIndex: -1,
          children: []
        }]
      },
      {
        offset: [-0.5,0,0],
        rotation: [Math.PI,0,0],
        scale: [1,1,1],
        parentIndex: -1,
        children: [{
          offset: [0,1,0],
          rotation: [0,0,0],
          scale: [1,1,1],
          parentIndex: -1,
          children: []
        }]
      }
    ]
  }
  */


  /**
   * ik更新
   * @param delta デルタ時間
   */
  updateIk(delta: number, mixer: THREE.AnimationMixer): void {
    if (!this.bones.length) {
      return;
    }

    // model→bones
    this.bones.forEach(bone => {
      bone.offset = convertVector3ToArray(bone.object?.position || new THREE.Vector3());
      bone.rotation = convertVector3ToArray(bone.object?.rotation || new THREE.Vector3());
      bone.scale = convertVector3ToArray(bone.object?.scale || new THREE.Vector3());
    });

    // ik計算しやすい形に変換
    const joints = convertBonesToJoints(this.bones);
    // 拘束にジョイント番号を入れておく
    const converted_constrains = [
      ...this.constrains.map(e => ({ ...e, joint: convertBoneToJointIndex(joints, e.bone) })),
      // ...ref_diff.map((e,i)=> ({priority: 0, joint: i, value: e, type: ConstrainType.RefPose})).filter((e,i)=>i<30) // 拘束による参照姿勢追随
    ];

    // スケルトンアニメーション更新
    this.settings.animation && mixer && mixer.update(delta);
    // 回転ジョイントに関しては、参照ポーズとの差分に対して解を求める。
    // Δθref = θref - θ
    const ref_diff = joints.map((joint, i) => {
      const bone = this.bones[joint.boneIndex];
      const obj = bone.animation_object;
      if (obj === undefined) {
        return 0;
      }
      const pos = convertVector3ToArray(obj.position);
      const rot = convertVector3ToArray(obj.rotation);
      return (
        joint.type === JointType.Revolution ? (
          !bone.slide && joint.axis === 0 && (bone.offset = joint.offset = pos),
          rotWrap(rot[joint.axis] - joint.value)) : // 角度は近道で移動
          joint.type === JointType.Slide ? (
            pos[joint.axis] - joint.value) :          // 差分
            joint.type === JointType.Static ? (
              bone.offset = joint.offset = pos,
              bone.rotation = joint.rotation = rot,
              0) : 0)
    });

    // ik計算
    solveJacobianIk(joints, converted_constrains, 8, 1 / 8, ref_diff);

    // joints -> bones
    applyJointsToBones(joints, this.bones);

    // bones->model
    this.bones.forEach((e, i) => {
      e.object?.position.set(...e.offset);
      e.object?.rotation.set(...e.rotation);
      e.object?.scale.set(...e.scale);
    });
  }
}

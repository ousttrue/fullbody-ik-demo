import * as THREE from 'three';
import * as ImGui from 'imgui-js/imgui.js';
import {
  Constraint, convertBonesToJoints, convertBoneToJointIndex
} from './constraint.js';
import { getJointOrientation, getJointWorldMatrix, getJointWorldPosition } from './ik';
import {
  ConstrainName, PriorityName, ConstrainType,
} from './def.js'
import { mul, rotXYZ, getRotationXYZ } from './math-util';
import * as math from "mathjs";
import * as ImGui_Impl from 'imgui-js/example/imgui_impl.js';


export const range = (num: number) => [...Array(num).keys()];

export const zip = <T, U>(arr1: T[], arr2: U[]): [T, U][] => arr1.map((k, i) => [k, arr2[i]]);

export const clamp = (a: number, max: number, min: number) => Math.min(Math.max(a, min), max);

// 回転の絶対値を 0~π に抑える
export const rotWrap = (rot: number) => {
  return (rot > Math.PI) ? rot - Math.PI * 2 :
    (rot < Math.PI * -1) ? rot + Math.PI * 2 : rot;
};

/**
 * ImGuiの角度表示関数改良版
 * @param label 
 * @param v_rad 
 * @param v_degrees_min 
 * @param v_degrees_max 
 */
export function SliderAngleFloat3(label: string, v_rad: number[], v_degrees_min = -360.0, v_degrees_max = +360.0): boolean {
  let _v_rad = math.clone(v_rad);
  _v_rad = math.multiply(_v_rad, 180 / Math.PI);
  const ret = ImGui.SliderFloat3(label, _v_rad, v_degrees_min, v_degrees_max, "%.1f deg");
  _v_rad = math.multiply(_v_rad, Math.PI / 180);
  v_rad.forEach((e, i) => v_rad[i] = _v_rad[i]);
  return ret;
}

/**
 * ImGui初期化
 */
export async function initImGui(canvas: HTMLCanvasElement) {
  await ImGui.default();
  ImGui.IMGUI_CHECKVERSION();
  ImGui.CreateContext();
  ImGui_Impl.Init(canvas);

  canvas.addEventListener('mousedown', event => {
    // 逆っぽいけど
    if (!ImGui.IsWindowHovered()) {
      event.stopImmediatePropagation();
    }
  }, false);
  canvas.addEventListener('touchstart', event => {
    if (!ImGui.IsWindowHovered()) {
      event.stopImmediatePropagation();
    }
  }, false);
}

/**
 * ImGuiフレーム表示開始
 * @param time 時間
 */
export function beginImGui(time: number) {
  ImGui_Impl.NewFrame(time);
  ImGui.NewFrame();
}

/**
 * ImGuiフレーム表示終了
 */
export function endImGui() {
  ImGui.EndFrame();
  ImGui.Render();
  ImGui_Impl.RenderDrawData(ImGui.GetDrawData());
}

/**
 * アニメのウェイト設定
 * @param action アクション
 * @param weight ウェイト 0~1
 */
export function setAnimWeight(action: THREE.AnimationAction, weight: number) {
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(weight);
  return weight;
}


/**
 * ImGuiによるデバッグ表示
 * @param time 時間
 */
export function drawImgui(time: number, constraint: Constraint,
  skeleton: THREE.SkeletonHelper,
  animation_compute_skeleton: THREE.SkeletonHelper,
  actions: THREE.AnimationAction[],
  mixer: THREE.AnimationMixer,
): void {
  ImGui.Begin("Debug Window");
  ImGui.Dummy(new ImGui.ImVec2(400, 0));

  // 稼働ルート
  if (ImGui.TreeNodeEx("flags##1", ImGui.ImGuiTreeNodeFlags.DefaultOpen)) {
    if (constraint.bones.length) {
      ImGui.Checkbox(`slide root`, (value = constraint.bones[0].slide || false) => {
        constraint.bones[0].slide = value;
        constraint.bones[0].static = !value;
        return value;
      })
    }
    // フラグ
    ImGui.Checkbox(`enable animation`, (value = constraint.settings.animation) => constraint.settings.animation = value);
    ImGui.Checkbox(`enable debug display`, (value = constraint.settings.debugDisp) => constraint.settings.debugDisp = value)
    {
      constraint.constrains.forEach(e => e.object && (e.object.visible = constraint.settings.debugDisp));
      skeleton && (skeleton.visible = constraint.settings.debugDisp);
      animation_compute_skeleton && (animation_compute_skeleton.visible = constraint.settings.debugDisp);
    }

    ImGui.TreePop();
  }

  // アニメーション
  if (ImGui.TreeNodeEx("animations##1", ImGui.ImGuiTreeNodeFlags.DefaultOpen)) {
    actions.forEach((action, i) => {
      ImGui.SliderFloat(`${action.getClip().name} weight`, (value = action.getEffectiveWeight()) => setAnimWeight(action, value), 0, 1);
    })

    if (mixer !== undefined) {
      const _mixer = mixer;
      ImGui.SliderFloat(`timeScale`, (scale = _mixer.timeScale) => _mixer.timeScale = scale, 0, 5);
    }

    ImGui.TreePop();
  }

  // ボーンデバッグ表示
  if (ImGui.TreeNode("bones##1")) {
    constraint.bones.forEach((e, i) => {
      ImGui.SliderFloat3(`pos[${i}] ${e.object?.name}`, e.offset, -5, 5)
      SliderAngleFloat3(`rot[${i}] ${e.object?.name}`, e.rotation, -180, 180)
      ImGui.SliderFloat3(`scale[${i}] ${e.object?.name}`, e.scale, 0.001, 1)

      // bones->model
      e.object?.position.set(...e.offset);
      e.object?.rotation.set(...e.rotation);
      e.object?.scale.set(...e.scale);
    });
    ImGui.TreePop();
  }
  ImGui.Separator();

  // 拘束デバッグ表示
  if (ImGui.TreeNodeEx("constrains##1", ImGui.ImGuiTreeNodeFlags.DefaultOpen)) {
    // ik計算しやすい形に変換
    const joints = convertBonesToJoints(constraint.bones);

    constraint.constrains.forEach((constrain, i) => {
      const joint = convertBoneToJointIndex(joints, constrain.bone);
      const pos = getJointWorldPosition(joints, joint);

      ImGui.PushID(i);
      ImGui.Text(`${ConstrainName[constrain.type]}`);

      if (ImGui.Checkbox(`enable`, (value = constrain.enable) => constrain.enable = value)) {
        constrain.object && (constrain.object.visible = constrain.enable);
        constrain.control && (constrain.control.enabled = constrain.enable);
      }

      ImGui.Combo(`priority`, (value = constrain.priority) => constrain.priority = value, PriorityName, 2);

      if (constrain.type === ConstrainType.Position) {
        ImGui.SliderFloat3(`constrain pos`, constrain.pos || [0, 0, 0], -2, 2)
        ImGui.SliderFloat3(`current`, pos, -100, 100);
        if (constrain.object) {
          constrain.object.position.set(...constrain.pos || [0, 0, 0]);
        }
      }
      else if (constrain.type === ConstrainType.Orientation) {
        const rot = getJointOrientation(joints, joint);
        SliderAngleFloat3(`constrain rot`, constrain.rot || [0, 0, 0], -180, 180)
        SliderAngleFloat3(`current`, rot, -180, 180);
        if (constrain.object) {
          constrain.object.rotation.set(...constrain.rot || [0, 0, 0]);
          constrain.object.position.set(...pos);
        }
      }
      else if (constrain.type === ConstrainType.OrientationBound) {
        if (constraint.bones[constrain.bone]) {
          const parentBone = constraint.bones[constrain.bone].parentIndex;
          const parent = parentBone != -1 ? getJointWorldMatrix(joints, convertBoneToJointIndex(joints, parentBone)) : math.identity(4);
          const rot = getJointOrientation(joints, joint);
          SliderAngleFloat3(`constrain rot bound`, constrain.base_rot || [0, 0, 0], -180, 180)
          SliderAngleFloat3(`current`, rot, -180, 180);
          if (constrain.object) {
            constrain.object.rotation.set(...getRotationXYZ(mul(parent, rotXYZ(...constrain.base_rot || [0, 0, 0]))));
            constrain.object.position.set(...pos);
          }
        }
      }
      ImGui.Separator();
      ImGui.PopID();
    });

    ImGui.TreePop();
  }

  ImGui.End();
}

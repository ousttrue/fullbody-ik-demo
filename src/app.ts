import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as math from "mathjs";
import { getJointWorldMatrix } from './ik';
import {
  mul, rotXYZ, getRotationXYZ, identity, cancelScaling, cancelTranslate
} from './math-util';
import { ConstrainType, Bone } from './def';
import {
  Constraint, convertVector3ToArray, convertBonesToJoints,
  convertBoneToJointIndex
} from './constraint.js';
import { drawImgui, setAnimWeight } from './gui.js';


const existFilter = <T>(x: T | undefined | null): x is T => x !== null || x !== undefined;


export class ThreeApp {
  constraint = new Constraint();
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 1, 10000);
  skeleton: THREE.SkeletonHelper;
  animation_compute_skeleton: THREE.SkeletonHelper;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[] = [];

  constructor(
    public readonly renderer: THREE.WebGLRenderer,
    modelfile: ArrayBuffer,
  ) {
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x263238);
    window.addEventListener('resize', (_) => {
      if (this.camera === undefined ||
        renderer === undefined) {
        return;
      }
      this.camera.aspect = window.innerWidth / window.innerHeight;
      // camera.setViewOffset( window.innerWidth, window.innerHeight * 2, 0, window.innerHeight * 0.3, window.innerWidth, window.innerHeight);
      this.camera.updateProjectionMatrix();
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, false);
    document.body.appendChild(renderer.domElement);
    this.camera.position.set(-5, 5, -5);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    dirLight.shadow.camera.right = 2;
    dirLight.shadow.camera.left = - 2;
    dirLight.shadow.camera.top = 2;
    dirLight.shadow.camera.bottom = - 2;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    // helper
    const axis = new THREE.AxesHelper(1000);
    this.scene.add(axis);

    // Controls
    const orbit = new OrbitControls(this.camera, this.renderer.domElement);
    orbit.minDistance = 2;
    orbit.maxDistance = 20;
    orbit.update();

    // -----------------------------------------
    // 拘束デバッグモデル
    // -----------------------------------------
    this.constraint.constrains.forEach(constrain => {
      const geometry =
        constrain.type === ConstrainType.Position ? new THREE.SphereGeometry(0.05) :
          constrain.type === ConstrainType.Orientation ? new THREE.CylinderGeometry(0, 0.05, 0.3) :
            constrain.type === ConstrainType.OrientationBound ? new THREE.CylinderGeometry(0.1, 0, 0.2) : undefined;
      if (geometry === undefined) {
        return;
      }
      const material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, wireframe: true, depthTest: false });
      constrain.object = new THREE.Mesh(geometry, material);
      if (constrain.type === ConstrainType.Position) {
        constrain.object.position.set(...constrain.pos || [0, 0, 0]);
      } else if (constrain.type === ConstrainType.Orientation) {
        constrain.object.rotation.set(...constrain.rot || [0, 0, 0]);
      } else if (constrain.type === ConstrainType.OrientationBound) {
        constrain.object.rotation.set(...constrain.base_rot || [0, 0, 0]);
      }
      constrain.object.renderOrder = 999; // always display
      this.scene.add(constrain.object);

      // 掴んで移動
      const control = new TransformControls(
        this.camera, this.renderer.domElement);
      constrain.control = control;
      control.size =
        constrain.type === ConstrainType.Orientation ||
          constrain.type === ConstrainType.OrientationBound ? 0.2 : 0.5;
      control.setMode(
        constrain.type === ConstrainType.Position ? "translate" :
          constrain.type === ConstrainType.Orientation ? "rotate" :
            constrain.type === ConstrainType.OrientationBound ? "rotate" : "translate");
      control.attach(constrain.object);
      control.addEventListener('change', (event) => {
        if (constrain.object === undefined) {
          return;
        }
        if (constrain.type === ConstrainType.Position) {
          constrain.pos = convertVector3ToArray(constrain.object.position);
        } else if (constrain.type === ConstrainType.Orientation) {
          constrain.rot = convertVector3ToArray(constrain.object.rotation);
        } else if (constrain.type === ConstrainType.OrientationBound) {
          const joints = convertBonesToJoints(this.constraint.bones);
          const parentBone = this.constraint.bones[constrain.bone].parentIndex;
          const parent = parentBone != -1 ? getJointWorldMatrix(joints, convertBoneToJointIndex(joints, parentBone)) : identity(4);
          const rotInv = math.transpose(cancelTranslate(cancelScaling(parent)));
          constrain.base_rot = getRotationXYZ(mul(rotInv, rotXYZ(...convertVector3ToArray(constrain.object.rotation))));
        }
      });
      control.addEventListener('dragging-changed', (event) => {
        orbit.enabled = !event.value;
      });
      this.scene.add(control);
    })

    // -----------------------------------------
    // モデルロード
    // -----------------------------------------
    var loader = new GLTFLoader();
    loader.parse(modelfile, '', (gltf) => {
      const model = gltf.scene;
      this.scene.add(model);

      // ボーンを摘出
      model.traverse((object) => {
        if (!(/Hand.+/).test(object.name) &&
          ((object as any).isBone ||
            (object.parent && (object.parent as any).isBone) ||
            object.children.reduce((prev, curr) => prev || (curr as any).isBone, false))) {
          const bone: Bone = {
            object: object,
            offset: convertVector3ToArray(object.position),
            rotation: convertVector3ToArray(object.rotation),
            scale: convertVector3ToArray(object.scale),
            parentIndex: this.constraint.bones.findIndex(e => e.object?.id === object.parent?.id),
            children: []
          }
          this.constraint.bones.push(bone);
        }
      });
      this.constraint.bones[0].static = true;
      // bones[0].slide = true;

      // アニメーション用ダミーモデル
      const animation_compute_model = SkeletonUtils.clone(model) as THREE.Object3D;
      animation_compute_model.visible = false;
      this.scene.add(animation_compute_model);

      this.constraint.bones.forEach(bone => {
        bone.animation_object = animation_compute_model?.getObjectByName(bone.object?.name || "");
      });

      // アニメーション
      this.mixer = new THREE.AnimationMixer(animation_compute_model);
      this.actions = gltf.animations.map(
        anim => this.mixer?.clipAction(anim)).filter(existFilter);
      this.actions.forEach((action, i) => {
        setAnimWeight(action, i == 1 ? 1.0 : 0.0);
        action.play();
      });

      // helper
      this.skeleton = new THREE.SkeletonHelper(model);
      this.skeleton.visible = true;
      this.scene.add(this.skeleton);

      this.animation_compute_skeleton = new THREE.SkeletonHelper(
        animation_compute_model);
      this.animation_compute_skeleton.visible = true;
      this.scene.add(this.animation_compute_skeleton);
    });

    // -----------------------------------------
    // ボーン組み立て
    // -----------------------------------------
    /*
    const buildBone = (tree: Bone, parentObject: THREE.Object3D, parentIndex: number)=>{
      const height = tree.children.length > 0 ? 1 : 0.2;
      const geometry = new THREE.CylinderGeometry( 0, 0.05, height);
      geometry.vertices.forEach(e=>e.y+=height/2);
      const material = new THREE.MeshStandardMaterial({color: 0xFFC107});
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...tree.offset);
      mesh.rotation.set(...tree.rotation);
      parentObject.add(mesh);
  
      tree.object = mesh;
      tree.parentIndex = parentIndex;
      bones.push(tree);
  
      const index = bones.length - 1;
      tree.children.forEach(e=> buildBone(e, mesh, index));
    }
    const group = new THREE.Group();
    buildBone(root, group, -1);
    scene.add(group);
    */
  }

  render(time: number) {
    const delta = this.clock.getDelta() || 0;

    // ik更新
    this.constraint.updateIk(delta, this.mixer);

    // デバッグ描画
    drawImgui(time, this.constraint,
      this.skeleton, this.animation_compute_skeleton,
      this.actions, this.mixer);

    // シーン描画
    this.renderer.render(this.scene, this.camera);
    this.renderer.state.reset();
  }
}

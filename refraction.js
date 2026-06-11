// Multi-bounce gem refraction material — adapted from drei's MeshRefractionMaterial
// (MIT, author N8Programs, https://github.com/N8python/diamonds) for vanilla Three.js.
// Rays enter the gem, bounce off interior facets via a GPU BVH, and sample the
// studio HDRI directly — the technique jewelry configurators use.
import * as THREE from 'three';
import { MeshBVH, MeshBVHUniformStruct, shaderStructs, shaderIntersectFunction, SAH } from 'three-mesh-bvh';

const vertexShader = /* glsl */ `
  uniform mat4 viewMatrixInverse;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying mat4 vModelMatrixInverse;

  void main() {
    vec4 transformedNormal = vec4(normal, 0.0);
    vec4 transformedPosition = vec4(position, 1.0);
    vModelMatrixInverse = inverse(modelMatrix);
    vWorldPosition = (modelMatrix * transformedPosition).xyz;
    vNormal = normalize((viewMatrixInverse * vec4(normalMatrix * transformedNormal.xyz, 0.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * transformedPosition;
  }`;

const fragmentShader = /* glsl */ `
  precision highp isampler2D;
  precision highp usampler2D;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying mat4 vModelMatrixInverse;

  uniform sampler2D envMap;
  uniform float bounces;
  ${shaderStructs}
  ${shaderIntersectFunction}
  uniform BVH bvh;
  uniform float ior;
  uniform bool correctMips;
  uniform vec2 resolution;
  uniform float fresnel;
  uniform mat4 modelMatrix;
  uniform mat4 projectionMatrixInverse;
  uniform mat4 viewMatrixInverse;
  uniform float aberrationStrength;
  uniform vec3 color;

  float fresnelFunc(vec3 viewDirection, vec3 worldNormal) {
    return pow( 1.0 + dot( viewDirection, worldNormal), 10.0 );
  }

  vec3 totalInternalReflection(vec3 ro, vec3 rd, vec3 normal, float ior, mat4 modelMatrixInverse) {
    vec3 rayOrigin = ro;
    vec3 rayDirection = rd;
    rayDirection = refract(rayDirection, normal, 1.0 / ior);
    rayOrigin = vWorldPosition + rayDirection * 0.001;
    rayOrigin = (modelMatrixInverse * vec4(rayOrigin, 1.0)).xyz;
    rayDirection = normalize((modelMatrixInverse * vec4(rayDirection, 0.0)).xyz);
    for(float i = 0.0; i < bounces; i++) {
      uvec4 faceIndices = uvec4( 0u );
      vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
      vec3 barycoord = vec3( 0.0 );
      float side = 1.0;
      float dist = 0.0;
      bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
      vec3 hitPos = rayOrigin + rayDirection * max(dist - 0.001, 0.0);
      vec3 tempDir = refract(rayDirection, faceNormal, ior);
      if (length(tempDir) != 0.0) {
        rayDirection = tempDir;
        break;
      }
      rayDirection = reflect(rayDirection, faceNormal);
      rayOrigin = hitPos + rayDirection * 0.01;
    }
    rayDirection = normalize((modelMatrix * vec4(rayDirection, 0.0)).xyz);
    return rayDirection;
  }

  #include <common>

  vec4 textureGradient(sampler2D envMap, vec3 rayDirection, vec3 directionCamPerfect) {
    vec2 uvv = equirectUv( rayDirection );
    vec2 smoothUv = equirectUv( directionCamPerfect );
    return textureGrad(envMap, uvv, dFdx(correctMips ? smoothUv : uvv), dFdy(correctMips ? smoothUv : uvv));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    vec3 directionCamPerfect = (projectionMatrixInverse * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
    directionCamPerfect = (viewMatrixInverse * vec4(directionCamPerfect, 0.0)).xyz;
    directionCamPerfect = normalize(directionCamPerfect);
    vec3 normal = vNormal;
    vec3 rayOrigin = cameraPosition;
    vec3 rayDirection = normalize(vWorldPosition - cameraPosition);

    vec4 diffuseColor = vec4(color, 1.0);

    vec3 rayDirectionG = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior, 1.0), vModelMatrixInverse);
    vec3 rayDirectionR = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 - aberrationStrength), 1.0), vModelMatrixInverse);
    vec3 rayDirectionB = totalInternalReflection(rayOrigin, rayDirection, normal, max(ior * (1.0 + aberrationStrength), 1.0), vModelMatrixInverse);
    float finalColorR = textureGradient(envMap, rayDirectionR, directionCamPerfect).r;
    float finalColorG = textureGradient(envMap, rayDirectionG, directionCamPerfect).g;
    float finalColorB = textureGradient(envMap, rayDirectionB, directionCamPerfect).b;
    diffuseColor.rgb *= vec3(finalColorR, finalColorG, finalColorB);

    vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
    float nFresnel = fresnelFunc(viewDirection, normal) * fresnel;
    gl_FragColor = vec4(mix(diffuseColor.rgb, vec3(1.0), nFresnel), diffuseColor.a);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// shared resolution vector — update via setRefractionResolution on init/resize
const RESOLUTION = new THREE.Vector2(1, 1);

export function setRefractionResolution(renderer) {
  renderer.getDrawingBufferSize(RESOLUTION);
}

// temporarily point gl_FragCoord math at an offscreen target (e.g. thumbnail renders)
export function overrideRefractionResolution(w, h) {
  RESOLUTION.set(w, h);
}

export function createGemRefractionMaterial(geometry, envMap, camera, opts = {}) {
  const bvh = new MeshBVH(geometry, { strategy: SAH, maxLeafTris: 1 });
  const bvhStruct = new MeshBVHUniformStruct();
  bvhStruct.updateFrom(bvh);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      envMap: { value: envMap },
      bvh: { value: bvhStruct },
      bounces: { value: opts.bounces ?? 3 },
      ior: { value: opts.ior ?? 2.4 },
      correctMips: { value: true },
      aberrationStrength: { value: opts.aberration ?? 0.01 },
      fresnel: { value: opts.fresnel ?? 0 },
      color: { value: new THREE.Color(opts.color ?? '#ffffff') },
      resolution: { value: RESOLUTION },
      viewMatrixInverse: { value: camera.matrixWorld },
      projectionMatrixInverse: { value: camera.projectionMatrixInverse },
    },
  });
  material.userData.bvhStruct = bvhStruct;
  return material;
}

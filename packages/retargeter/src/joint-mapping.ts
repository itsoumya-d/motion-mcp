import { JointMap, JointMapping } from "./types.js";

export const SMPLX_TO_MIXAMO: JointMap = {
    pelvis: "mixamorig:Hips",
    left_hip: "mixamorig:LeftUpLeg",
    right_hip: "mixamorig:RightUpLeg",
    spine1: "mixamorig:Spine",
    left_knee: "mixamorig:LeftLeg",
    right_knee: "mixamorig:RightLeg",
    spine2: "mixamorig:Spine1",
    left_ankle: "mixamorig:LeftFoot",
    right_ankle: "mixamorig:RightFoot",
    spine3: "mixamorig:Spine2",
    left_foot: "mixamorig:LeftToeBase",
    right_foot: "mixamorig:RightToeBase",
    neck: "mixamorig:Neck",
    left_collar: "mixamorig:LeftShoulder",
    right_collar: "mixamorig:RightShoulder",
    head: "mixamorig:Head",
    left_shoulder: "mixamorig:LeftArm",
    right_shoulder: "mixamorig:RightArm",
    left_elbow: "mixamorig:LeftForeArm",
    right_elbow: "mixamorig:RightForeArm",
    left_wrist: "mixamorig:LeftHand",
    right_wrist: "mixamorig:RightHand"
};

export const SMPLX_TO_UNITY_HUMANOID: JointMap = {
    pelvis: "Hips",
    left_hip: "LeftUpperLeg",
    right_hip: "RightUpperLeg",
    spine1: "Spine",
    left_knee: "LeftLowerLeg",
    right_knee: "RightLowerLeg",
    spine2: "Chest",
    left_ankle: "LeftFoot",
    right_ankle: "RightFoot",
    spine3: "UpperChest",
    left_foot: "LeftToes",
    right_foot: "RightToes",
    neck: "Neck",
    left_collar: "LeftShoulder",
    right_collar: "RightShoulder",
    head: "Head",
    left_shoulder: "LeftUpperArm",
    right_shoulder: "RightUpperArm",
    left_elbow: "LeftLowerArm",
    right_elbow: "RightLowerArm",
    left_wrist: "LeftHand",
    right_wrist: "RightHand"
};

export const SMPLX_TO_UE_MANNEQUIN: JointMap = {
    pelvis: "pelvis",
    left_hip: "thigh_l",
    right_hip: "thigh_r",
    spine1: "spine_01",
    left_knee: "calf_l",
    right_knee: "calf_r",
    spine2: "spine_02",
    left_ankle: "foot_l",
    right_ankle: "foot_r",
    spine3: "spine_03",
    left_foot: "ball_l",
    right_foot: "ball_r",
    neck: "neck_01",
    left_collar: "clavicle_l",
    right_collar: "clavicle_r",
    head: "head",
    left_shoulder: "upperarm_l",
    right_shoulder: "upperarm_r",
    left_elbow: "lowerarm_l",
    right_elbow: "lowerarm_r",
    left_wrist: "hand_l",
    right_wrist: "hand_r"
};

export const JOINT_ALIASES: Record<string, string[]> = {
    "pelvis": ["hips", "root", "waist", "center"],
    "left_hip": ["l_hip", "left_up_leg", "l_up_leg", "leftupleg"],
    "right_hip": ["r_hip", "right_up_leg", "r_up_leg", "rightupleg"],
    "left_knee": ["l_knee", "left_leg", "l_leg", "leftleg"],
    "right_knee": ["r_knee", "right_leg", "r_leg", "rightleg"],
    "left_ankle": ["l_ankle", "left_foot", "l_foot", "leftfoot"],
    "right_ankle": ["r_ankle", "right_foot", "r_foot", "rightfoot"],
    "left_foot": ["l_toe", "left_toe", "l_toes"],
    "right_foot": ["r_toe", "right_toe", "r_toes"],
    "spine1": ["spine", "spine_1", "spine01", "abdomen"],
    "spine2": ["spine_2", "spine02", "chest", "torso"],
    "spine3": ["spine_3", "spine03", "upper_chest", "upperchest"],
    "neck": ["neck_1", "neck01", "cervical"],
    "head": ["head_1", "skull"],
    "left_collar": ["l_collar", "left_shoulder", "l_shoulder", "clavicle_l"],
    "right_collar": ["r_collar", "right_shoulder", "r_shoulder", "clavicle_r"],
    "left_shoulder": ["l_shoulder", "left_arm", "l_arm", "leftupperarm"],
    "right_shoulder": ["r_shoulder", "right_arm", "r_arm", "rightupperarm"],
    "left_elbow": ["l_elbow", "left_forearm", "l_forearm", "leftlowerarm"],
    "right_elbow": ["r_elbow", "right_forearm", "r_forearm", "rightlowerarm"],
    "left_wrist": ["l_wrist", "left_hand", "l_hand", "lefthand"],
    "right_wrist": ["r_wrist", "right_hand", "r_hand", "righthand"]
};

function levenshtein(a: string, b: string): number {
    const matrix = Array.from({ length: b.length + 1 }, () => new Array(a.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            if (b.charAt(j - 1) === a.charAt(i - 1)) {
                matrix[j][i] = matrix[j - 1][i - 1];
            } else {
                matrix[j][i] = Math.min(
                    matrix[j - 1][i - 1] + 1,
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function autoMapJoints(sourceNames: string[], targetNames: string[]): JointMapping {
    const map: JointMap = {};
    const unmappedSource: string[] = [];
    const unmappedTarget = new Set(targetNames);
    let matchCount = 0;

    for (const src of sourceNames) {
        const normSrc = normalizeName(src);
        let bestTarget = "";
        let bestScore = Infinity;

        const aliases = JOINT_ALIASES[normSrc] || [normSrc];
        
        for (const target of targetNames) {
            const normTarget = normalizeName(target);
            for (const alias of aliases) {
                const dist = levenshtein(normalizeName(alias), normTarget);
                if (dist < bestScore) {
                    bestScore = dist;
                    bestTarget = target;
                }
            }
        }

        if (bestScore <= 3 && bestTarget) {
            map[src] = bestTarget;
            unmappedTarget.delete(bestTarget);
            matchCount++;
        } else {
            unmappedSource.push(src);
        }
    }

    const confidence = matchCount / sourceNames.length;

    return {
        map,
        unmappedSource,
        unmappedTarget: Array.from(unmappedTarget),
        confidence
    };
}

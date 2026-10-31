// Shapes of the Live2D / VTube Studio files we read, limited to the fields we use.

export interface Model3Json {
  Version: number;
  FileReferences: {
    Moc: string;
    Textures: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    UserData?: string;
    Expressions?: { Name: string; File: string }[];
    Motions?: Record<string, Model3Motion[]>;
  };
  Groups?: { Target: string; Name: string; Ids: string[] }[];
  HitAreas?: { Id: string; Name: string }[];
  Layout?: Record<string, number>;
}

export interface Model3Motion {
  File: string;
  FadeInTime?: number;
  FadeOutTime?: number;
  Sound?: string;
}

export interface VtubeJson {
  Name?: string;
  FileReferences?: {
    Model?: string;
    IdleAnimation?: string;
    IdleAnimationWhenTrackingLost?: string;
  };
  Hotkeys?: {
    Name: string;
    Action: string;
    File: string;
    StopsOnLastFrame?: boolean;
  }[];
}

export interface Cdi3Json {
  Parameters?: { Id: string; GroupId?: string; Name: string }[];
}

// What the app knows about a model after normalizing it.

export interface ProfileExpression {
  name: string;
  file: string;
  label: string;
}

export interface ProfileMotion {
  group: string;
  index: number;
  file: string;
  label: string;
  /** VTube Studio "stop on last frame": the pose stays after the motion ends. */
  holdLastFrame: boolean;
}

export interface ModelCapabilities {
  eyeBlink: boolean;
  lipSyncIds: string[];
  /** Has ParamA/I/U/E/O, so speech can drive vowel shapes instead of a single open/close. */
  vowels: boolean;
  /** Has ARKit-style face parameters (JawOpen, MouthSmile_L, ...). */
  arkit: boolean;
  physics: boolean;
  breath: boolean;
  look: boolean;
}

export interface ModelProfile {
  name: string;
  expressions: ProfileExpression[];
  motions: ProfileMotion[];
  idleGroup: string | null;
  capabilities: ModelCapabilities;
  parameterNames: Record<string, string>;
  /** Where each piece of the profile came from, for the import report. */
  sources: string[];
}

export interface NormalizedModel {
  model3: Model3Json;
  profile: ModelProfile;
}

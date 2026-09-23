declare module "firebase/firestore" {
  import type { FirebaseApp } from "firebase/app";

  export interface Firestore {
    readonly app: FirebaseApp;
  }

  export interface CollectionReference {
    readonly path: string;
  }

  export interface DocumentReference {
    readonly path: string;
    readonly id: string;
  }

  export interface DocumentSnapshot {
    readonly metadata: {
      readonly fromCache: boolean;
    };
    exists(): boolean;
    data(): Record<string, unknown>;
  }

  export interface SnapshotListenOptions {
    readonly includeMetadataChanges?: boolean;
  }

  export function getFirestore(app?: FirebaseApp): Firestore;
  export function connectFirestoreEmulator(firestore: Firestore, host: string, port: number): void;
  export function collection(firestore: Firestore, path: string): CollectionReference;
  export function doc(collection: CollectionReference): DocumentReference;
  export function doc(firestore: Firestore, path: string, ...pathSegments: string[]): DocumentReference;
  export function getDoc(reference: DocumentReference): Promise<DocumentSnapshot>;
  export function setDoc(
    reference: DocumentReference,
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ): Promise<void>;
  export function serverTimestamp(): unknown;
  export function writeBatch(firestore: Firestore): {
    set(reference: DocumentReference, data: Record<string, unknown>): void;
    commit(): Promise<void>;
  };
  export function onSnapshot(
    reference: DocumentReference,
    options: SnapshotListenOptions,
    onNext: (snapshot: DocumentSnapshot) => void,
    onError: (error: Error) => void,
  ): () => void;
}

declare module "firebase/storage" {
  import type { FirebaseApp } from "firebase/app";

  export interface FirebaseStorage {
    readonly app: FirebaseApp;
  }

  export interface StorageReference {
    readonly fullPath: string;
  }

  export interface UploadMetadata {
    contentType?: string;
  }

  export function getStorage(app?: FirebaseApp): FirebaseStorage;
  export function ref(storage: FirebaseStorage, path: string): StorageReference;
  export function uploadBytes(
    reference: StorageReference,
    data: Uint8Array,
    metadata?: UploadMetadata,
  ): Promise<unknown>;
  export function getMetadata(reference: StorageReference): Promise<unknown>;
  export function deleteObject(reference: StorageReference): Promise<void>;
}

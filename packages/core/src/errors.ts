/** Base class for all errors raised by the memory engine. */
export class TarsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A referenced record could not be found (or is soft-deleted when that matters). */
export class NotFoundError extends TarsError {
  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`${kind} not found: ${id}`);
  }
}

export class EntityNotFoundError extends NotFoundError {
  constructor(id: string) {
    super('entity', id);
  }
}

export class ObservationNotFoundError extends NotFoundError {
  constructor(id: string) {
    super('observation', id);
  }
}

export class RelationNotFoundError extends NotFoundError {
  constructor(id: string) {
    super('relation', id);
  }
}

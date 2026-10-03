use anchor_lang::prelude::*;

#[error_code]
pub enum ReflectError {
    #[msg("Signer is not the registry admin")]
    Unauthorized,
    #[msg("Signer is not a registered operator")]
    UnauthorizedOperator,
    #[msg("Operator set is full")]
    OperatorSetFull,
    #[msg("Operator already registered")]
    OperatorAlreadyRegistered,
    #[msg("Operator not found")]
    OperatorNotFound,
    #[msg("min_number must be between 1 and MAX_OPERATORS (64)")]
    InvalidQuorum,
    #[msg("Invalid configuration value")]
    InvalidConfig,
    #[msg("Invalid aggregation rule")]
    InvalidRule,
    #[msg("Consensus round is not open")]
    RoundNotOpen,
    #[msg("Submission window has closed")]
    WindowClosed,
    #[msg("Read slot falls outside the consensus window")]
    SlotOutsideWindow,
    #[msg("Submission window is still open")]
    WindowStillOpen,
    #[msg("Submission buffer is full")]
    SubmissionBufferFull,
    #[msg("Operator already submitted this round")]
    DuplicateSubmission,
    #[msg("Round already finalized or closed")]
    AlreadyFinalized,
    #[msg("Consensus account does not match the provided DataFeed / window")]
    IdentityMismatch,
    #[msg("Weight vector does not sum to MAX_BPS")]
    InvalidRatios,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("An older round cannot overwrite more recent published state")]
    StaleRound,
}

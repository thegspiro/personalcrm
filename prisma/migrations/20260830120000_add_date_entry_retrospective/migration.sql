-- Add optional retrospective fields without inventing answers for existing dates.
ALTER TABLE `DateEntry`
    ADD COLUMN `wouldDoAgain` BOOLEAN NULL,
    ADD COLUMN `nextTimeNotes` TEXT NULL;

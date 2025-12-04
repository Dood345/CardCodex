package com.independent.cardcodex.core_database

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        SpeciesEntity::class, 
        CardEntity::class,
        CardCollectionEntity::class,
        DeckEntity::class,
        DeckCardCrossRef::class
    ], 
    version = 3, 
    exportSchema = false
)
@TypeConverters(StringListConverter::class, CardConverters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun cardDao(): CardDao
    abstract fun collectionDao(): CollectionDao
    abstract fun deckDao(): DeckDao
}

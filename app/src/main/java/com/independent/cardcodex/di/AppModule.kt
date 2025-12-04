package com.independent.cardcodex.di

import android.content.Context
import androidx.room.Room
import com.independent.cardcodex.core_database.AppDatabase
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.data.ManifestApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import javax.inject.Singleton

import android.content.SharedPreferences

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideSharedPreferences(@ApplicationContext context: Context): SharedPreferences {
        return context.getSharedPreferences("card_codex_prefs", Context.MODE_PRIVATE)
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "card_codex_db"
        )
        .fallbackToDestructiveMigration()
        .fallbackToDestructiveMigrationOnDowngrade()
        .build()
    }

    @Provides
    @Singleton
    fun provideCardDao(db: AppDatabase): CardDao {
        return db.cardDao()
    }

    @Provides
    @Singleton
    fun provideCollectionDao(db: AppDatabase): com.independent.cardcodex.core_database.CollectionDao {
        return db.collectionDao()
    }

    @Provides
    @Singleton
    fun provideDeckDao(db: AppDatabase): com.independent.cardcodex.core_database.DeckDao {
        return db.deckDao()
    }

    @Provides
    @Singleton
    fun provideRetrofit(): Retrofit {
        return Retrofit.Builder()
            .baseUrl("https://raw.githubusercontent.com/") // Base URL placeholder
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideManifestApi(retrofit: Retrofit): ManifestApi {
        return retrofit.create(ManifestApi::class.java)
    }
}

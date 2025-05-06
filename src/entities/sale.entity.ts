import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { Product } from './product.entity';

@Entity('sales')
export class Sale {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    quantity: number;

    @Column('decimal', { precision: 10, scale: 2 })
    totalPrice: number;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    saleDate: Date;

    @Column()
    userId: number;

    @Column()
    productId: number;

    @ManyToOne(() => User, user => user.sales)
    @JoinColumn({ name: 'userId' }) // Especifica la columna de la clave foránea
    user: User;

    @ManyToOne(() => Product, product => product.sales)
    @JoinColumn({ name: 'productId' }) // Especifica la columna de la clave foránea
    product: Product;
}
